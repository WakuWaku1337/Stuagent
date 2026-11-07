interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatJson<T>(messages: ChatMessage[], temperature = 0.3): Promise<T> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`LLM 调用失败（${res.status}）: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return parseJson<T>(raw);
}

export function parseJson<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error(`无法解析模型 JSON 输出: ${trimmed.slice(0, 120)}`);
  }
}