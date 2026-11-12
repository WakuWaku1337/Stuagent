import { RagCallError, ragTimeoutSignal, withRetry } from './resilience.ts';

export interface RerankResult {
  index: number;
  score: number;
}

/** Cross-Encoder 精排：gte-rerank-v2（与 LLM 同一 workspace） */
export async function rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY');
  const host = new URL(baseUrl).origin;
  const model = process.env.RERANK_MODEL ?? 'gte-rerank-v2';

  const data = await withRetry('Rerank 请求', async () => {
    const res = await fetch(`${host}/api/v1/services/rerank/text-rerank/text-rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: { query, documents },
        parameters: { return_documents: false, top_n: topN },
      }),
      signal: ragTimeoutSignal(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new RagCallError(
        'RERANK_HTTP_ERROR',
        `Rerank 失败（${res.status}）${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        res.status === 408 || res.status === 429 || res.status >= 500,
      );
    }
    return (await res.json()) as { output?: { results?: { index: number; relevance_score: number }[] } };
  });
  const results = data.output?.results ?? [];
  return results.map((r) => ({ index: r.index, score: r.relevance_score }));
}