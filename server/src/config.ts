import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 配置模块可能先于 index.ts 的 loadEnvFile 被导入，这里保证 .env 在读取常量前生效
const envPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim() === '1' || raw.trim().toLowerCase() === 'true';
}

function envText(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(envNumber(name, fallback))));
}

export const CHAT_HISTORY_LIMIT = envNumber('CHAT_HISTORY_LIMIT', 16);
export const HISTORY_ITEM_MAX_CHARS = envNumber('HISTORY_ITEM_MAX_CHARS', 6000);
export const ROUTE_LLM_MIN_CHARS = envNumber('ROUTE_LLM_MIN_CHARS', 24);
export const RERANK_MIN_QUERY_CHARS = envNumber('RERANK_MIN_QUERY_CHARS', 16);
export const RAG_TOP_K = envNumber('RAG_TOP_K', 5);
export const RAG_CANDIDATE_K = envNumber('RAG_CANDIDATE_K', 30);
export const RAG_RECALL_LIMIT = envNumber('RAG_RECALL_LIMIT', 50);

/** 历史回放条数：与配置同源，保留旧接口的 4–60 夹取 */
export function historyReplayLimit(): number {
  return Math.min(60, Math.max(4, Math.round(CHAT_HISTORY_LIMIT)));
}

export const RAG_TIMEOUT_MS = Math.max(1000, Math.round(envNumber('RAG_TIMEOUT_MS', 15_000)));
export const MILVUS_TIMEOUT_MS = Math.max(1000, Math.round(envNumber('MILVUS_TIMEOUT_MS', 15_000)));
export const RAG_RETRY_MAX = Math.max(0, Math.round(envNumber('RAG_RETRY_MAX', 2)));

export const AGENT_MAX_TOOL_STEPS = Math.max(0, Math.round(envNumber('AGENT_MAX_TOOL_STEPS', 10)));
export const AGENT_WALL_CLOCK_MS = Math.max(0, Math.round(envNumber('AGENT_WALL_CLOCK_MS', 180_000)));
export const AGENT_TOKEN_BUDGET = Math.max(0, Math.round(envNumber('AGENT_TOKEN_BUDGET', 0)));

export const TASK_RETRY_MAX = Math.max(0, Math.round(envNumber('TASK_RETRY_MAX', 3)));

export const FAST_MODEL_ID = envText('FAST_MODEL_ID');
export const EVAL_ENABLE_ADVANCED = envFlag('EVAL_ENABLE_ADVANCED', false);

export const CSRF_ENABLED = envFlag('CSRF_ENABLED', true);
export const CSRF_ALLOWED_ORIGINS = envText('CSRF_ALLOWED_ORIGINS')
  .split(',')
  .map((item) => item.trim().replace(/\/+$/, ''))
  .filter(Boolean);
export const BOOTSTRAP_LOCAL_ONLY = envFlag('BOOTSTRAP_LOCAL_ONLY', true);
export const MCP_CONFIRM_SIDE_EFFECTS = envFlag('MCP_CONFIRM_SIDE_EFFECTS', true);
/** 远程 MCP 允许的主机白名单（逗号分隔，支持 *.example.com）；为空表示不限制主机。 */
export const MCP_ALLOWED_HOSTS = envText('MCP_ALLOWED_HOSTS')
  .split(',')
  .map((item) => item.trim().toLowerCase().replace(/^\*?\./, ''))
  .filter(Boolean);
export const TRACE_LOG = envFlag('TRACE_LOG', false);

/** 切片脱敏在调用时读取开关，便于脚本在同一进程验证开/关两种行为 */
export function documentPiiRedactEnabled(): boolean {
  return envFlag('DOCUMENT_PII_REDACT', false);
}

export const TTS_DEFAULT_VOLUME = Math.min(1, Math.max(0, envNumber('TTS_DEFAULT_VOLUME', 1)));

export const LLM_KEY_MAX_ATTEMPTS = boundedInt('LLM_KEY_MAX_ATTEMPTS', 3, 1, 20);
