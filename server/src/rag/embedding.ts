const BATCH = 10;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-v4';
  if (!baseUrl || !apiKey) throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY');

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: batch, dimensions: 1024, encoding_format: 'float' }),
    });
    if (!res.ok) throw new Error(`Embedding 失败（${res.status}）: ${await res.text()}`);
    const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    vectors.push(...sorted.map((d) => d.embedding));
  }
  return vectors;
}