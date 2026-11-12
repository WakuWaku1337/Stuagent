import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { TRACE_LOG } from './config.ts';
import { filterOutput } from './security/guard.ts';

const storage = new AsyncLocalStorage<string>();

export function newTraceId(): string {
  return randomUUID();
}

export function enterTrace(traceId: string): string {
  storage.enterWith(traceId);
  return traceId;
}

export function currentTraceId(): string {
  return storage.getStore() ?? '';
}

function safeString(value: string): string {
  return filterOutput(value).text.slice(0, 2000);
}

function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    output[key] = typeof value === 'string' ? safeString(value) : value;
  }
  return output;
}

/** 链路日志默认关闭；开启后入参出参先脱敏再落日志 */
export function traceLog(event: string, payload: Record<string, unknown> = {}): void {
  if (!TRACE_LOG) return;
  try {
    console.log(
      JSON.stringify({
        level: 'trace',
        trace_id: currentTraceId(),
        event,
        ...safePayload(payload),
        at: Date.now(),
      }),
    );
  } catch {
    // 日志失败不影响主流程
  }
}
