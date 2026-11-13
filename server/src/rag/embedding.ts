import { createHash } from 'node:crypto';
import { db } from '../store.ts';
import { RagCallError, ragTimeoutSignal, withRetry } from './resilience.ts';

const BATCH = 10;
const CACHE_TTL_MS = Number(process.env.EMBEDDING_CACHE_DAYS ?? 30) * 86_400_000;

function cacheKey(model: string, text: string): string {
  return createHash('sha256').update(`${model}\0${text}`).digest('hex');
}

function readCache(key: string): number[] | null {
  const row = db.prepare('SELECT vector, created_at FROM embedding_cache WHERE cache_key = ?').get(key) as
    | { vector: string; created_at: number }
    | undefined;
  if (!row) return null;
  if (CACHE_TTL_MS > 0 && Date.now() - row.created_at > CACHE_TTL_MS) {
    db.prepare('DELETE FROM embedding_cache WHERE cache_key = ?').run(key);
    return null;
  }
  try {
    const vector = JSON.parse(row.vector) as unknown;
    return Array.isArray(vector) ? (vector as number[]) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, model: string, vector: number[]): void {
  db.prepare(
    'INSERT INTO embedding_cache (cache_key, model, vector, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET vector = excluded.vector, created_at = excluded.created_at',
  ).run(key, model, JSON.stringify(vector), Date.now());
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-v4';
  if (!baseUrl || !apiKey) throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY');

  const vectors: (number[] | null)[] = texts.map((text) => readCache(cacheKey(model, text)));
  const missing: { index: number; text: string; key: string }[] = [];
  texts.forEach((text, index) => {
    if (!vectors[index]) missing.push({ index, text, key: cacheKey(model, text) });
  });

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    const data = await withRetry('Embedding 请求', async () => {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          input: batch.map((item) => item.text),
          dimensions: 1024,
          encoding_format: 'float',
        }),
        signal: ragTimeoutSignal(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new RagCallError(
          'EMBEDDING_HTTP_ERROR',
          `Embedding 失败（${res.status}）${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          res.status === 408 || res.status === 429 || res.status >= 500,
        );
      }
      return (await res.json()) as { data: { index: number; embedding: number[] }[] };
    });
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== batch.length) {
      throw new RagCallError(
        'EMBEDDING_COUNT_MISMATCH',
        `Embedding 返回数量不一致 ${sorted.length}/${batch.length}`,
        false,
      );
    }
    sorted.forEach((item, offset) => {
      const target = batch[offset];
      vectors[target.index] = item.embedding;
      writeCache(target.key, model, item.embedding);
    });
  }

  return vectors.map((vector, index) => {
    if (!vector) throw new Error(`Embedding 缺失（第 ${index + 1} 条）`);
    return vector;
  });
}
