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
  type: 'delta' | 'done' | 'error' | 'citations' | 'route' | 'conversation' | 'security';
  text?: string;
  message?: string;
  citations?: Citation[];
  agent?: string;
  agent_name?: string;
  reason?: string;
  conversation_id?: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
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
): Promise<void> {
  const url = conversationId
    ? `/api/conversations/${encodeURIComponent(conversationId)}/messages`
    : '/api/chat';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, stream: true, ...(reasoning ? { reasoning } : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? data?.message ?? `请求失败（${res.status}）`);
  }
  await parseStream(res.body, onEvent);
}
