import type { MessageAttachment } from './conversations';
import type { Visualization } from './visualize';

export interface Citation {
  index: number;
  chunk_id: string;
  source_id: string;
  source_name: string;
  chapter: string;
  page: number;
  score: number;
  snippet: string;
}

export interface ChatStreamEvent {
  type:
    | 'delta'
    | 'done'
    | 'error'
    | 'citations'
    | 'route'
    | 'conversation'
    | 'security'
    | 'media'
    | 'continuation'
    | 'incomplete'
    | 'visualization'
    | 'thinking';
  text?: string;
  message?: string;
  citations?: Citation[];
  visualization?: Visualization;
  matched?: string;
  attempt?: number;
  agent?: string;
  agent_name?: string;
  reason?: string;
  conversation_id?: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
  vision?: boolean;
  ocr_used?: boolean;
  ocr_text?: string;
  attachments?: MessageAttachment[];
  trace_id?: string;
}

const SSE_RETRY_MAX = Math.max(0, Number(import.meta.env.VITE_SSE_RETRY_MAX ?? 2));

/** C01：一次用户发送生成一次，断线重发复用同一个，服务端据此去重避免重复落库。 */
function newClientRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

class ChatRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ChatRequestError';
    this.status = status;
  }
}

function reportUnauthorized(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('edupi:unauthorized'));
}

function retryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
}

function parseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (!dataLine) continue;
        try {
          onEvent(JSON.parse(dataLine) as ChatStreamEvent);
        } catch {
          // 忽略不完整帧
        }
      }
    }
  })();
}

export async function streamChatIn(
  conversationId: string | null,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  reasoning?: 'low' | 'medium' | 'high',
  mediaIds?: string[],
  action?: 'continue' | 'regenerate',
): Promise<void> {
  const url = conversationId
    ? `/api/conversations/${encodeURIComponent(conversationId)}/messages`
    : '/api/chat';
  let receivedAny = false;
  let attempt = 0;
  const clientRequestId = newClientRequestId();

  const requestOnce = async (): Promise<void> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stream: true,
        clientRequestId,
        ...(reasoning ? { reasoning } : {}),
        ...(mediaIds?.length ? { mediaIds } : {}),
        ...(action === 'continue' ? { continue: true } : {}),
        ...(action === 'regenerate' ? { regenerate: true } : {}),
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      if (res.status === 401 || res.status === 4401) reportUnauthorized();
      const data = await res.json().catch(() => null);
      throw new ChatRequestError(
        data?.error ?? data?.message ?? `请求失败（${res.status}）`,
        res.status,
      );
    }
    await parseStream(res.body, (event) => {
      receivedAny = true;
      onEvent(event);
    });
    if (!receivedAny) throw new ChatRequestError('连接中断（未收到数据）', 0);
  };

  for (;;) {
    try {
      await requestOnce();
      return;
    } catch (error) {
      if (signal?.aborted) throw error;
      const status = error instanceof ChatRequestError ? error.status : 0;
      if (status === 401 || status === 4401) {
        reportUnauthorized();
        throw error;
      }
      // 仅在尚未收到任何事件时重发，避免已输出 delta 后重复生成
      if (receivedAny || !retryableStatus(status) || attempt >= SSE_RETRY_MAX) {
        if (receivedAny && !signal?.aborted) {
          onEvent({
            type: 'incomplete',
            message: '连接中断，已生成的内容已保留，可点击“继续生成”',
          });
        }
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt + Math.random() * 200));
    }
  }
}
