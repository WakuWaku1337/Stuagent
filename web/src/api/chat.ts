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
  type: 'delta' | 'done' | 'error' | 'citations' | 'route';
  text?: string;
  message?: string;
  citations?: Citation[];
  agent?: string;
  agent_name?: string;
  reason?: string;
}

export async function streamChat(
  message: string,
  sessionId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `请求失败（${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
}