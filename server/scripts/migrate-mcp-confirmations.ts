/**
 * B1-4b：MCP 副作用工具确认态的存量回填 CLI。
 *
 * 背景：mcp_tool_confirmations 是整改新增表，side_effect 默认 1、confirmed_at 默认为空，
 * 而 MCP_CONFIRM_SIDE_EFFECTS 默认开启，导致升级前已授权的工具全部返回
 * MCP_CONFIRMATION_REQUIRED。此脚本在升级时执行一次，把存量已授权工具标记为已确认。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/migrate-mcp-confirmations.ts           # dry-run，只列计划
 *   node --import jiti/register scripts/migrate-mcp-confirmations.ts --apply  # 核对清单后写入
 *
 * 回填逻辑在 src/mcp/backfill.ts，与 check-mcp.ts 的回归用例共用同一实现。
 * 写操作默认不执行，必须显式加 --apply（human-in-the-loop 二次确认）。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { db } = await import('../src/store.ts');
const { planMcpConfirmationBackfill, applyMcpConfirmationBackfill } = await import(
  '../src/mcp/backfill.ts'
);

const apply = process.argv.includes('--apply');
const plan = planMcpConfirmationBackfill();

console.log(`待回填工具: ${plan.length}`);
for (const item of plan) {
  console.log(`  ${item.server} / ${item.tool} (side_effect=${item.sideEffect})`);
}

if (!apply) {
  console.log('dry-run：未写入任何数据。核对清单后加 --apply 执行回填。');
} else {
  const written = applyMcpConfirmationBackfill(plan);
  console.log(`已回填 ${written} 条；重复运行不会产生新写入。`);
}

db.close();
process.exitCode = 0;
