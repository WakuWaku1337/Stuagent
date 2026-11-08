import { db } from '../store.ts';
import { currentLearnerId } from '../learning/context.ts';
import type { Citation } from '../rag/service.ts';

const TTL_MS = Number(process.env.ANSWER_CACHE_TTL_MIN ?? 60) * 60_000;

export interface CachedAnswer {
  answer: string;
  citations: Citation[];
}

export function getAnswerCache(key: string): CachedAnswer | null {
  const row = db.prepare('SELECT answer, citations, created_at FROM answer_cache WHERE cache_key = ?').get(key) as
    | { answer: string; citations: string | null; created_at: number }
    | undefined;
  if (!row) return null;
  if (TTL_MS > 0 && Date.now() - row.created_at > TTL_MS) {
    db.prepare('DELETE FROM answer_cache WHERE cache_key = ?').run(key);
    return null;
  }
  let citations: Citation[] = [];
  try {
    const parsed = row.citations ? (JSON.parse(row.citations) as unknown) : [];
    if (Array.isArray(parsed)) citations = parsed as Citation[];
  } catch {
    citations = [];
  }
  return { answer: row.answer, citations };
}

export function putAnswerCache(key: string, answer: string, citations: Citation[]): void {
  if (TTL_MS <= 0 || !answer.trim()) return;
  db.prepare(
    `INSERT INTO answer_cache (cache_key, learner_id, answer, citations, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET answer = excluded.answer, citations = excluded.citations, created_at = excluded.created_at`,
  ).run(key, currentLearnerId(), answer, citations.length ? JSON.stringify(citations) : null, Date.now());
}

export function invalidateAnswerCache(learnerId = currentLearnerId()): void {
  db.prepare('DELETE FROM answer_cache WHERE learner_id = ?').run(learnerId);
}
