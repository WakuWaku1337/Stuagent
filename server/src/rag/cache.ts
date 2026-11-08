import { currentLearnerId } from '../learning/context.ts';

interface CacheEntry {
  vector: number[];
  subject: string | null;
  topK: number;
  result: unknown;
  created_at: number;
}

const TTL_MS = Number(process.env.RAG_CACHE_TTL_MIN ?? 10) * 60_000;
const MAX_ENTRIES = Number(process.env.RAG_CACHE_MAX ?? 80);
const THRESHOLD = Number(process.env.RAG_CACHE_THRESHOLD ?? 0.96);
const stores = new Map<string, CacheEntry[]>();

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export function getSemanticCache<T>(
  vector: number[],
  subject: string | undefined,
  topK: number,
  learnerId = currentLearnerId(),
): T | null {
  const entries = stores.get(learnerId);
  if (!entries?.length) return null;
  const now = Date.now();
  let best: { score: number; entry: CacheEntry } | null = null;
  for (const entry of entries) {
    if (TTL_MS > 0 && now - entry.created_at > TTL_MS) continue;
    if ((entry.subject ?? undefined) !== subject || entry.topK !== topK) continue;
    const score = cosine(vector, entry.vector);
    if (score >= THRESHOLD && (!best || score > best.score)) best = { score, entry };
  }
  return best ? (best.entry.result as T) : null;
}

export function putSemanticCache<T>(
  vector: number[],
  subject: string | undefined,
  topK: number,
  result: T,
  learnerId = currentLearnerId(),
): void {
  if (THRESHOLD >= 1) return;
  let entries = stores.get(learnerId);
  if (!entries) {
    entries = [];
    stores.set(learnerId, entries);
  }
  entries.push({ vector, subject: subject ?? null, topK, result, created_at: Date.now() });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function invalidateRagCache(learnerId = currentLearnerId()): void {
  stores.delete(learnerId);
}
