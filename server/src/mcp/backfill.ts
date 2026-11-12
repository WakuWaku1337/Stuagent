/**
 * B1-4b：MCP 副作用工具确认态的存量回填（供迁移 CLI 与回归脚本共用）。
 *
 * 只回填「升级前已存在且已授权」的工具；mcp_tool_confirmations 中已有记录
 * （含人工撤销确认后 confirmed_at 为 NULL）一律跳过，不覆盖人工决策。
 * 更新后新增的服务/工具不回填，仍走管理页配置期确认。
 */
import { db } from '../store.ts';

export interface BackfillItem {
  serverId: string;
  server: string;
  tool: string;
  sideEffect: number;
}

interface ServerRow {
  server_id: string;
  name: string;
  tools: string | null;
  enabled_tools: string | null;
}

interface StoredTool {
  name?: string;
  side_effect?: boolean;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function planMcpConfirmationBackfill(): BackfillItem[] {
  const servers = db
    .prepare('SELECT server_id, name, tools, enabled_tools FROM mcp_servers ORDER BY created_at ASC')
    .all() as unknown as ServerRow[];
  const existingRows = db
    .prepare('SELECT server_id, tool_name FROM mcp_tool_confirmations')
    .all() as unknown as { server_id: string; tool_name: string }[];
  const existing = new Set(existingRows.map((row) => `${row.server_id}\0${row.tool_name}`));

  const plan: BackfillItem[] = [];
  for (const server of servers) {
    const tools = parseJson<StoredTool[]>(server.tools, []);
    // enabled_tools 为 NULL 表示未做工具级裁剪，即全部工具已授权。
    const enabled =
      server.enabled_tools === null ? null : new Set(parseJson<string[]>(server.enabled_tools, []));
    for (const tool of tools) {
      if (!tool?.name) continue;
      if (enabled && !enabled.has(tool.name)) continue;
      if (existing.has(`${server.server_id}\0${tool.name}`)) continue;
      plan.push({
        serverId: server.server_id,
        server: server.name,
        tool: tool.name,
        sideEffect: tool.side_effect === false ? 0 : 1,
      });
    }
  }
  return plan;
}

export function applyMcpConfirmationBackfill(items: BackfillItem[]): number {
  if (items.length === 0) return 0;
  const insert = db.prepare(
    `INSERT INTO mcp_tool_confirmations (server_id, tool_name, side_effect, confirmed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(server_id, tool_name) DO NOTHING`,
  );
  const now = Date.now();
  let written = 0;
  db.exec('BEGIN');
  try {
    for (const item of items) {
      written += Number(insert.run(item.serverId, item.tool, item.sideEffect, now).changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return written;
}
