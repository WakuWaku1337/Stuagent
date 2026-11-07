import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';

export interface WrongRow {
  record_id: string;
  question_id: string;
  question_snapshot: string;
  student_answer: string | null;
  reason: string | null;
  review_count: number;
  ease: number;
  interval_days: number;
  next_review: number;
  created_at: number;
  last_review: number | null;
}

export function addWrongRecord(input: {
  learnerId: string;
  questionId: string;
  snapshot: unknown;
  studentAnswer?: string;
  reason?: string;
}): WrongRow {
  const existing = db
    .prepare('SELECT record_id FROM wrong_records WHERE learner_id = ? AND question_id = ?')
    .get(input.learnerId, input.questionId) as { record_id: string } | undefined;
  const now = Date.now();
  if (existing) {
    db.prepare('UPDATE wrong_records SET student_answer = ?, reason = ?, next_review = ? WHERE record_id = ?').run(
      input.studentAnswer ?? null,
      input.reason ?? null,
      now,
      existing.record_id,
    );
    return db.prepare('SELECT * FROM wrong_records WHERE record_id = ?').get(existing.record_id) as unknown as WrongRow;
  }
  const recordId = randomUUID();
  db.prepare(
    `INSERT INTO wrong_records (record_id, learner_id, question_id, question_snapshot, student_answer, reason, review_count, ease, interval_days, next_review, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 2.5, 0, ?, ?)`,
  ).run(
    recordId,
    input.learnerId,
    input.questionId,
    JSON.stringify(input.snapshot),
    input.studentAnswer ?? null,
    input.reason ?? null,
    now,
    now,
  );
  return db.prepare('SELECT * FROM wrong_records WHERE record_id = ?').get(recordId) as unknown as WrongRow;
}

export function listWrongRecords(learnerId: string, dueOnly = false): WrongRow[] {
  const now = Date.now();
  const sql = dueOnly
    ? 'SELECT * FROM wrong_records WHERE learner_id = ? AND next_review <= ? ORDER BY next_review ASC'
    : 'SELECT * FROM wrong_records WHERE learner_id = ? ORDER BY created_at DESC';
  return db.prepare(sql).all(...(dueOnly ? [learnerId, now] : [learnerId])) as unknown as WrongRow[];
}

/** SM-2 简化版：quality 0-5，>=3 表示复习通过 */
export function reviewWrongRecord(id: string, quality: number): WrongRow {
  const row = db.prepare('SELECT * FROM wrong_records WHERE record_id = ?').get(id) as unknown as WrongRow | undefined;
  if (!row) throw new Error('错题记录不存在');
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let ease = row.ease;
  let interval: number;
  if (q < 3) {
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    ease = Math.min(3.0, ease + 0.1);
    interval = row.interval_days <= 0 ? 1 : Math.round(row.interval_days * ease);
  }
  const now = Date.now();
  const nextReview = now + interval * 24 * 60 * 60 * 1000;
  db.prepare(
    'UPDATE wrong_records SET review_count = review_count + 1, ease = ?, interval_days = ?, next_review = ?, last_review = ? WHERE record_id = ?',
  ).run(ease, interval, nextReview, now, id);
  return db.prepare('SELECT * FROM wrong_records WHERE record_id = ?').get(id) as unknown as WrongRow;
}

export function deleteWrongRecord(id: string): void {
  db.prepare('DELETE FROM wrong_records WHERE record_id = ?').run(id);
}

export function dueCount(learnerId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM wrong_records WHERE learner_id = ? AND next_review <= ?')
    .get(learnerId, Date.now()) as { n: number };
  return row.n;
}