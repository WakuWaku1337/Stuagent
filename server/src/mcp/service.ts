import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { db } from '../store.ts';
import { decryptSecret, encryptSecret } from '../settings/crypto.ts';
import { MCP_ALLOWED_HOSTS, MCP_CONFIRM_SIDE_EFFECTS } from '../config.ts';
import { recordAuthEvent } from '../auth/service.ts';
import { traceLog } from '../trace.ts';

export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpExposure = 'direct' | 'deferred' | 'codemode' | 'hidden';
export type McpStatus = 'unknown' | 'connected' | 'error' | 'disabled';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  side_effect: boolean;
  confirmed_at: number | null;
}

export interface McpServerView {
  server_id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env_keys: string[];
  header_keys: string[];
  enabled: boolean;
  exposure: McpExposure;
  status: McpStatus;
  last_error: string | null;
  tools: McpToolInfo[];
  created_at: number;
  updated_at: number;
}

export interface McpServerInput {
  name: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  exposure?: McpExposure;
}

interface McpRow {
  server_id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string | null;
  url: string | null;
  secrets: string | null;
  enabled: number;
  exposure: McpExposure;
  status: McpStatus;
  last_error: string | null;
  tools: string | null;
  enabled_tools: string | null;
  created_at: number;
  updated_at: number;
}

export class McpError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = status;
  }
}

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const dataRoot = process.env.EDU_DATA_DIR?.trim()
  ? resolve(process.env.EDU_DATA_DIR)
  : resolve(serverRoot, 'data');
const agentDir = join(dataRoot, 'pi-agent');
const mcpConfigPath = join(agentDir, 'mcp.json');
/** stdio MCP 只继承进程启动所需的最小环境，实例级密钥默认不下传。 */
const STDIO_ENV_KEYS =
  process.platform === 'win32'
    ? [
        'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
        'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
        'PROGRAMFILES', 'PROGRAMFILES(X86)', 'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE',
      ]
    : ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LANGUAGE', 'USER', 'SHELL', 'PWD'];
const STDIO_ENV_PASSTHROUGH = [
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
];

export function stdioEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [...STDIO_ENV_KEYS, ...STDIO_ENV_PASSTHROUGH]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

/** 远程 MCP 只接受 http/https；配置 MCP_ALLOWED_HOSTS 时再校验来源主机。 */
export function validateMcpUrl(raw: string | null | undefined): string {
  const value = raw?.trim() ?? '';
  if (!value) throw new McpError('MCP_URL_REQUIRED', 'MCP 需要填写 URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpError('MCP_URL_INVALID', 'MCP URL 格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new McpError('MCP_URL_PROTOCOL_NOT_ALLOWED', 'MCP URL 仅支持 http/https 协议');
  }
  if (MCP_ALLOWED_HOSTS.length > 0) {
    const host = url.hostname.toLowerCase();
    const allowed = MCP_ALLOWED_HOSTS.some(
      (pattern) => pattern === '*' || host === pattern || host.endsWith(`.${pattern}`),
    );
    if (!allowed) {
      throw new McpError('MCP_HOST_NOT_ALLOWED', `MCP 来源主机未在允许列表中：${url.hostname}`, 403);
    }
  }
  return url.toString();
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new McpError('MCP_NAME_REQUIRED', 'MCP 名称不能为空');
  if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(name)) {
    throw new McpError('MCP_NAME_INVALID', 'MCP 名称只能包含字母、数字、下划线、点或短横线（≤40 字符）');
  }
  return name;
}

function normalizeTransport(value: unknown): McpTransport {
  if (value === undefined) return 'stdio';
  if (value === 'stdio' || value === 'http' || value === 'sse') return value;
  throw new McpError('MCP_TRANSPORT_INVALID', 'MCP transport 只能是 stdio / http / sse');
}
function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).slice(0, 30);
}

function normalizeSecrets(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string') continue;
    const cleanKey = key.trim().slice(0, 60);
    if (cleanKey) output[cleanKey] = item.slice(0, 2000);
  }
  return output;
}

function readSecrets(row: McpRow): { env: Record<string, string>; headers: Record<string, string> } {
  if (!row.secrets) return { env: {}, headers: {} };
  try {
    const parsed = parseJson<{ env?: Record<string, string>; headers?: Record<string, string> }>(
      decryptSecret(row.secrets),
      {},
    );
    return { env: normalizeSecrets(parsed.env), headers: normalizeSecrets(parsed.headers) };
  } catch {
    return { env: {}, headers: {} };
  }
}

function confirmationsOf(serverId: string): Map<string, number> {
  const rows = db
    .prepare(
      'SELECT tool_name, confirmed_at FROM mcp_tool_confirmations WHERE server_id = ? AND confirmed_at IS NOT NULL',
    )
    .all(serverId) as unknown as { tool_name: string; confirmed_at: number }[];
  return new Map(rows.map((row) => [row.tool_name, row.confirmed_at]));
}

/** 只有明确声明 readOnlyHint 的工具视为无副作用；未知一律要求确认 */
function toolSideEffect(tool: { annotations?: { readOnlyHint?: boolean } }): boolean {
  return tool.annotations?.readOnlyHint !== true;
}

function toolsOf(row: McpRow): McpToolInfo[] {
  const tools = parseJson<
    { name: string; description?: string; inputSchema?: Record<string, unknown>; side_effect?: boolean }[]
  >(row.tools, []);
  const enabled = row.enabled_tools ? new Set(parseJson<string[]>(row.enabled_tools, [])) : null;
  const confirmed = confirmationsOf(row.server_id);
  return tools
    .filter((tool) => Boolean(tool?.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      enabled: enabled ? enabled.has(tool.name) : true,
      side_effect: tool.side_effect ?? true,
      confirmed_at: confirmed.get(tool.name) ?? null,
    }));
}

function toView(row: McpRow): McpServerView {
  const secrets = readSecrets(row);
  return {
    server_id: row.server_id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: parseJson<string[]>(row.args, []),
    url: row.url,
    env_keys: Object.keys(secrets.env),
    header_keys: Object.keys(secrets.headers),
    enabled: row.enabled === 1,
    exposure: row.exposure,
    status: row.enabled === 1 ? row.status : 'disabled',
    last_error: row.last_error,
    tools: toolsOf(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getRow(id: string): McpRow | undefined {
  return db.prepare('SELECT * FROM mcp_servers WHERE server_id = ?').get(id) as unknown as McpRow | undefined;
}

function getRowByName(name: string): McpRow | undefined {
  return db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as unknown as McpRow | undefined;
}

export function listMcpServers(): McpServerView[] {
  return (db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all() as unknown as McpRow[]).map(toView);
}

export function mcpTools(): { server: McpServerView; tool: McpToolInfo }[] {
  const output: { server: McpServerView; tool: McpToolInfo }[] = [];
  for (const server of listMcpServers()) {
    if (!server.enabled || server.exposure === 'hidden') continue;
    for (const tool of server.tools) {
      if (tool.enabled) output.push({ server, tool });
    }
  }
  return output;
}

function buildTransport(row: McpRow) {
  const secrets = readSecrets(row);
  if (row.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(validateMcpUrl(row.url)), {
      requestInit: { headers: secrets.headers },
    });
  }
  if (row.transport === 'sse') {
    return new SSEClientTransport(new URL(validateMcpUrl(row.url)), {
      requestInit: { headers: secrets.headers },
    });
  }
  if (!row.command) throw new McpError('MCP_COMMAND_REQUIRED', 'stdio MCP 需要填写启动命令');
  return new StdioClientTransport({
    command: row.command,
    args: parseJson<string[]>(row.args, []),
    env: stdioEnv(secrets.env),
  });
}

async function connect(row: McpRow): Promise<{ client: Client; tools: McpToolInfo[] }> {
  const client = new Client({ name: 'edupi-mcp', version: '0.1.0' }, { capabilities: {} });
  const transport = buildTransport(row);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('MCP 连接超时（15s）')), 15_000);
  });
  try {
    await Promise.race([client.connect(transport), timeout]);
    const result = await Promise.race([client.listTools(), timeout]);
    const enabledTools = row.enabled_tools ? new Set(parseJson<string[]>(row.enabled_tools, [])) : null;
    const tools = (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
      enabled: enabledTools ? enabledTools.has(tool.name) : true,
      side_effect: toolSideEffect(tool),
      confirmed_at: null as number | null,
    }));
    return { client, tools };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

function updateStatus(id: string, patch: { status: McpStatus; last_error?: string | null; tools?: McpToolInfo[] }) {
  const now = Date.now();
  if (patch.tools) {
    db.prepare(
      `UPDATE mcp_servers SET status = ?, last_error = ?, tools = ?, updated_at = ? WHERE server_id = ?`,
    ).run(
      patch.status,
      patch.last_error ?? null,
      JSON.stringify(
        patch.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          side_effect: tool.side_effect,
        })),
      ),
      now,
      id,
    );
  } else {
    db.prepare('UPDATE mcp_servers SET status = ?, last_error = ?, updated_at = ? WHERE server_id = ?').run(
      patch.status,
      patch.last_error ?? null,
      now,
      id,
    );
  }
}

export function createMcpServer(input: McpServerInput): McpServerView {
  const name = normalizeName(input.name);
  if (getRowByName(name)) throw new McpError('MCP_NAME_EXISTS', 'MCP 名称已存在', 409);
  const transport = normalizeTransport(input.transport);
  const secrets = {
    env: normalizeSecrets(input.env),
    headers: normalizeSecrets(input.headers),
  };
  const url = transport === 'http' || transport === 'sse' ? validateMcpUrl(input.url) : null;
  if (transport === 'stdio' && !input.command?.trim()) {
    throw new McpError('MCP_COMMAND_REQUIRED', 'stdio MCP 需要填写启动命令');
  }
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO mcp_servers
       (server_id, name, transport, command, args, url, secrets, enabled, exposure, status, last_error, tools, enabled_tools, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    name,
    transport,
    input.command?.trim() || null,
    JSON.stringify(normalizeArgs(input.args)),
    url,
    encryptSecret(JSON.stringify(secrets)),
    input.enabled === false ? 0 : 1,
    input.exposure ?? 'direct',
    now,
    now,
  );
  syncMcpJson().catch(() => undefined);
  return toView(getRow(id)!);
}

export function updateMcpServer(
  id: string,
  input: Partial<McpServerInput> & { secretsUnchanged?: boolean },
): McpServerView {
  const row = getRow(id);
  if (!row) throw new McpError('MCP_NOT_FOUND', 'MCP 服务不存在', 404);
  const name = input.name === undefined ? row.name : normalizeName(input.name);
  const duplicate = getRowByName(name);
  if (duplicate && duplicate.server_id !== id) throw new McpError('MCP_NAME_EXISTS', 'MCP 名称已存在', 409);
  const transport = input.transport === undefined ? row.transport : normalizeTransport(input.transport);
  let secrets = readSecrets(row);
  if (input.env !== undefined || input.headers !== undefined) {
    secrets = {
      env: input.env === undefined ? secrets.env : normalizeSecrets(input.env),
      headers: input.headers === undefined ? secrets.headers : normalizeSecrets(input.headers),
    };
  }
  const command = input.command === undefined ? row.command : input.command?.trim() || null;
  const rawUrl = input.url === undefined ? row.url : input.url?.trim() || null;
  const url = transport === 'http' || transport === 'sse' ? validateMcpUrl(rawUrl) : rawUrl;
  if (transport === 'stdio' && !command) throw new McpError('MCP_COMMAND_REQUIRED', 'stdio MCP 需要填写启动命令');

  const resetConnection = input.name !== undefined || input.transport !== undefined || input.command !== undefined ||
    input.url !== undefined || input.args !== undefined || input.env !== undefined || input.headers !== undefined;

  db.prepare(
    `UPDATE mcp_servers SET name = ?, transport = ?, command = ?, args = ?, url = ?, secrets = ?,
       enabled = ?, exposure = ?, status = ?, last_error = ?,
       tools = CASE WHEN ? = 1 THEN tools ELSE NULL END,
       enabled_tools = CASE WHEN ? = 1 THEN enabled_tools ELSE NULL END,
       updated_at = ?
     WHERE server_id = ?`,
  ).run(
    name,
    transport,
    command,
    JSON.stringify(input.args === undefined ? parseJson<string[]>(row.args, []) : normalizeArgs(input.args)),
    url,
    encryptSecret(JSON.stringify(secrets)),
    input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
    input.exposure ?? row.exposure,
    resetConnection ? 'unknown' : row.status,
    resetConnection ? null : row.last_error,
    resetConnection ? 1 : 0,
    resetConnection ? 1 : 0,
    Date.now(),
    id,
  );
  syncMcpJson().catch(() => undefined);
  return toView(getRow(id)!);
}

export function deleteMcpServer(id: string): boolean {
  const row = getRow(id);
  if (!row) return false;
  db.prepare('DELETE FROM mcp_tool_confirmations WHERE server_id = ?').run(id);
  db.prepare('DELETE FROM mcp_servers WHERE server_id = ?').run(id);
  syncMcpJson().catch(() => undefined);
  return true;
}

export async function testMcpServer(id: string): Promise<{ server: McpServerView; latency_ms: number }> {
  const row = getRow(id);
  if (!row) throw new McpError('MCP_NOT_FOUND', 'MCP 服务不存在', 404);
  const started = Date.now();
  try {
    const { client, tools } = await connect(row);
    await client.close().catch(() => undefined);
    updateStatus(id, { status: 'connected', last_error: null, tools });
    return { server: toView(getRow(id)!), latency_ms: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus(id, { status: 'error', last_error: message });
    throw new McpError('MCP_CONNECT_FAILED', message, 502);
  }
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: unknown[]; structured?: unknown }> {
  const row = getRow(serverId);
  if (!row) throw new McpError('MCP_NOT_FOUND', 'MCP 服务不存在', 404);
  if (row.enabled !== 1) throw new McpError('MCP_DISABLED', 'MCP 服务未启用', 409);
  const tools = toolsOf(row);
  const tool = tools.find((item) => item.name === toolName);
  if (!tool) throw new McpError('MCP_TOOL_NOT_FOUND', 'MCP 工具不存在，请先重新测试连接', 404);
  if (!tool.enabled) throw new McpError('MCP_TOOL_DISABLED', 'MCP 工具未授权', 409);
  if (MCP_CONFIRM_SIDE_EFFECTS && tool.side_effect && !tool.confirmed_at) {
    recordAuthEvent(null, 'mcp_tool_blocked', 'blocked', { server: row.name, tool: toolName });
    throw new McpError(
      'MCP_CONFIRMATION_REQUIRED',
      '该工具可能产生副作用，请在 MCP 管理页确认后再调用',
      409,
    );
  }
  const { client } = await connect(row);
  try {
    const result = (await client.callTool({ name: toolName, arguments: args })) as {
      content?: unknown[];
      structuredContent?: unknown;
    };
    return { content: result.content ?? [], structured: result.structuredContent };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function setMcpToolEnabled(serverId: string, toolName: string, enabled: boolean): McpServerView {
  const row = getRow(serverId);
  if (!row) throw new McpError('MCP_NOT_FOUND', 'MCP 服务不存在', 404);
  const tools = toolsOf(row);
  if (!tools.some((tool) => tool.name === toolName)) {
    throw new McpError('MCP_TOOL_NOT_FOUND', 'MCP 工具不存在', 404);
  }
  const names = new Set(
    tools.filter((tool) => (tool.name === toolName ? enabled : tool.enabled)).map((tool) => tool.name),
  );
  db.prepare('UPDATE mcp_servers SET enabled_tools = ?, updated_at = ? WHERE server_id = ?').run(
    JSON.stringify([...names]),
    Date.now(),
    serverId,
  );
  return toView(getRow(serverId)!);
}

/** 配置期显式授权：管理页勾选后写入，供 callMcpTool 校验 */
export function confirmMcpTool(serverId: string, toolName: string): McpServerView {
  const row = getRow(serverId);
  if (!row) throw new McpError('MCP_NOT_FOUND', 'MCP 服务不存在', 404);
  const tool = toolsOf(row).find((item) => item.name === toolName);
  if (!tool) throw new McpError('MCP_TOOL_NOT_FOUND', 'MCP 工具不存在', 404);
  const timestamp = Date.now();
  db.prepare(
    `INSERT INTO mcp_tool_confirmations (server_id, tool_name, side_effect, confirmed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(server_id, tool_name) DO UPDATE SET
       side_effect = excluded.side_effect,
       confirmed_at = excluded.confirmed_at`,
  ).run(serverId, toolName, tool.side_effect ? 1 : 0, timestamp);
  recordAuthEvent(null, 'mcp_tool_confirmed', 'success', { server: row.name, tool: toolName });
  return toView(getRow(serverId)!);
}

export async function syncMcpJson(): Promise<void> {
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all() as unknown as McpRow[];
  const servers: Record<string, unknown> = {};
  for (const row of rows) {
    // 方案 A：mcp.json 不落任何解密后的 env/headers。
    // Pi 原生 MCP 只拿到命令/URL/开关，实际调用由 createMcpTools() 从加密 DB 解密后建立连接。
    if (row.transport === 'http' || row.transport === 'sse') {
      if (!row.url) continue;
      servers[row.name] = {
        url: row.url,
        enabled: row.enabled === 1,
        exposure: row.exposure,
      };
    } else if (row.command) {
      const args = parseJson<string[]>(row.args, []);
      servers[row.name] = {
        command: row.command,
        ...(args.length ? { args } : {}),
        enabled: row.enabled === 1,
        exposure: row.exposure,
      };
    }
  }
  await mkdir(agentDir, { recursive: true });
  await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`, 'utf8');
}

function safeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'tool';
}

export async function createMcpTools() {
  return mcpTools().map(({ server, tool }) =>
    defineTool({
      name: `mcp__${safeToolName(server.name)}__${safeToolName(tool.name)}`,
      label: `${server.name} · ${tool.name}`,
      description: tool.description || `MCP 工具 ${server.name}/${tool.name}`,
      parameters: tool.inputSchema as never,
      async execute(_id, params) {
        traceLog('mcp.tool.call', { server: server.name, tool: tool.name });
        const result = await callMcpTool(server.server_id, tool.name, params as Record<string, unknown>);
        const text = result.content
          .map((item) => {
            if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
              return String((item as { text?: string }).text ?? '');
            }
            return JSON.stringify(item);
          })
          .filter(Boolean)
          .join('\n');
        return {
          content: [{ type: 'text' as const, text: text || 'MCP 工具已执行，无文本输出' }],
          details: result,
        };
      },
    }),
  );
}
