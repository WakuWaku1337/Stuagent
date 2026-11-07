interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
}

/** 多模态识别：图片整卷 → 模型 JSON 输出 */
export async function chatVisionJson<T>(dataUrl: string, instruction: string, temperature = 0.2): Promise<T> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY');

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.VISION_MODEL ?? process.env.LLM_MODEL,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`多模态识别失败（${res.status}）: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return (await import('./llm.ts')).parseJson<T>(raw);
}