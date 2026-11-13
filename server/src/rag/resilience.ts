import { RAG_RETRY_MAX, RAG_TIMEOUT_MS } from '../config.ts';

export class RagCallError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.name = 'RagCallError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function ragTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(RAG_TIMEOUT_MS);
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof RagCallError) return error.retryable;
  return true;
}

/**
 * RAG 外部调用的统一重试：次数 + 指数退避 + 抖动。
 * 每次尝试使用独立的超时信号，避免复用已超时的 AbortSignal。
 * 连接池说明：Node 原生 fetch 默认复用 undici 的 keep-alive 连接，无需额外 agent。
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: { retries?: number; baseMs?: number; jitterMs?: number } = {},
): Promise<T> {
  const retries = Math.max(0, options.retries ?? RAG_RETRY_MAX);
  const baseMs = options.baseMs ?? 300;
  const jitterMs = options.jitterMs ?? 120;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) break;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** attempt + Math.random() * jitterMs));
    }
  }

  if (lastError instanceof RagCallError) throw lastError;
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const timedOut = lastError instanceof DOMException && lastError.name === 'TimeoutError';
  const aborted = lastError instanceof DOMException && lastError.name === 'AbortError';
  throw new RagCallError(
    timedOut || aborted ? 'RAG_TIMEOUT' : 'RAG_CALL_FAILED',
    `${label}失败：${message}`,
    false,
  );
}
