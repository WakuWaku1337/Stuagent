import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';

export interface QuestionRow {
  question_id: string;
  bank_id: string;
  subject: string | null;
  knowledge_point: string;
  difficulty: string;
  content: string;
  options: string;
  answer: string;
  explanation: string | null;
  source: string | null;
}

interface LlmQuestion {
  stem: string;
  options: { A: string; B: string; C: string; D: string };
  answer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  knowledge_point?: string;
}

export function saveQuestions(
  items: LlmQuestion[],
  meta: { bankId: string; subject?: string; knowledgePoint: string; difficulty: string; source?: string },
): QuestionRow[] {
  const rows: QuestionRow[] = [];
  const stmt = db.prepare(
    `INSERT INTO questions (question_id, bank_id, subject, knowledge_point, difficulty, content, options, answer, explanation, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const q of items) {
    const id = randomUUID();
    const row: QuestionRow = {
      question_id: id,
      bank_id: meta.bankId,
      subject: meta.subject ?? null,
      knowledge_point: q.knowledge_point?.trim() || meta.knowledgePoint,
      difficulty: meta.difficulty,
      content: q.stem.trim(),
      options: JSON.stringify(q.options),
      answer: q.answer,
      explanation: q.explanation ?? null,
      source: meta.source ?? null,
    };
    stmt.run(
      row.question_id,
      row.bank_id,
      row.subject,
      row.knowledge_point,
      row.difficulty,
      row.content,
      row.options,
      row.answer,
      row.explanation,
      row.source,
      Date.now(),
    );
    rows.push(row);
  }
  return rows;
}

export function getQuestion(id: string): QuestionRow | undefined {
  return db.prepare('SELECT * FROM questions WHERE question_id = ?').get(id) as unknown as QuestionRow | undefined;
}

export function listQuestions(filter: { bankId?: string; subject?: string; limit?: number }): QuestionRow[] {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (filter.bankId) {
    clauses.push('bank_id = ?');
    values.push(filter.bankId);
  }
  if (filter.subject) {
    clauses.push('subject = ?');
    values.push(filter.subject);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM questions ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values, filter.limit ?? 100) as unknown as QuestionRow[];
}

export function listBanks(): { bank_id: string; source: string | null; count: number; created_at: number }[] {
  return db
    .prepare(
      `SELECT bank_id, MAX(source) AS source, COUNT(*) AS count, MAX(created_at) AS created_at
       FROM questions GROUP BY bank_id ORDER BY created_at DESC`,
    )
    .all() as unknown as { bank_id: string; source: string | null; count: number; created_at: number }[];
}

export function pickRandomQuestions(count: number, bankId?: string, subject?: string): QuestionRow[] {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (bankId) {
    clauses.push('bank_id = ?');
    values.push(bankId);
  }
  if (subject) {
    clauses.push('subject = ?');
    values.push(subject);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM questions ${where} ORDER BY RANDOM() LIMIT ?`)
    .all(...values, count) as unknown as QuestionRow[];
}

export function publicQuestion(q: QuestionRow) {
  return {
    question_id: q.question_id,
    knowledge_point: q.knowledge_point,
    difficulty: q.difficulty,
    content: q.content,
    options: JSON.parse(q.options) as Record<string, string>,
    answer: q.answer,
    explanation: q.explanation,
  };
}