import { db } from '../store.ts';
import { DEFAULT_LEARNER } from './memory.ts';
import { listMastery } from './mastery.ts';
import { listWrongRecords } from './wrongbook.ts';
import { answerQuestion, generateQuiz, sessionInfo, sessionQuestionIds, startSession, type GradeResult } from './quiz.ts';
import { getQuestion, publicQuestion, type QuestionRow } from './questions.ts';

export type DailyStatus = 'active' | 'completed';

export interface DailyPractice {
  date: string;
  learner_id: string;
  session_id: string;
  total: number;
  status: DailyStatus;
  score: number | null;
  created_at: number;
  finished_at: number | null;
}

export interface DailyHistoryItem {
  date: string;
  status: DailyStatus;
  score: number | null;
  total: number;
}

export interface DailyQuestion {
  question_id: string;
  knowledge_point: string;
  difficulty: string;
  content: string;
  options: Record<string, string>;
}

export interface DailyOverview {
  practice: DailyPractice | null;
  questions: DailyQuestion[];
  answered_ids: string[];
  streak: number;
  history: DailyHistoryItem[];
  recommendation: { focus_points: string[]; due_wrong: number };
}

export interface StartDailyResult {
  practice: DailyPractice;
  questions: DailyQuestion[];
  answered_ids: string[];
  reused: boolean;
  streak: number;
}

export interface AnswerDailyResult {
  result: GradeResult;
  practice: DailyPractice;
  streak: number;
  completed: boolean;
}

export class DailyError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DailyError';
    this.code = code;
    this.status = status;
  }
}

interface DailyRow {
  date: string;
  learner_id: string;
  session_id: string;
  total: number;
  status: DailyStatus;
  score: number | null;
  created_at: number;
  finished_at: number | null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function previousDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() - days);
  return isoDate(parsed);
}

function dailyCount(): number {
  const value = Number(process.env.DAILY_PRACTICE_COUNT ?? 5);
  return Number.isFinite(value) ? Math.min(10, Math.max(3, Math.round(value))) : 5;
}

function getRow(date: string): DailyRow | undefined {
  return db
    .prepare('SELECT * FROM daily_practices WHERE date = ? AND learner_id = ?')
    .get(date, DEFAULT_LEARNER) as unknown as DailyRow | undefined;
}

function updateRow(
  date: string,
  patch: { status?: DailyStatus; score?: number | null; finished_at?: number | null },
): DailyRow | undefined {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.score !== undefined) {
    fields.push('score = ?');
    values.push(patch.score);
  }
  if (patch.finished_at !== undefined) {
    fields.push('finished_at = ?');
    values.push(patch.finished_at);
  }
  if (fields.length === 0) return getRow(date);
  values.push(date, DEFAULT_LEARNER);
  db.prepare(`UPDATE daily_practices SET ${fields.join(', ')} WHERE date = ? AND learner_id = ?`).run(...values);
  return getRow(date);
}

/** 若用户在别处把会话交卷，同步每日状态。 */
function syncStatus(row: DailyRow): DailyRow {
  if (row.status === 'completed') return row;
  const session = sessionInfo(row.session_id);
  if (!session || session.status !== 'finished') return row;
  return (
    updateRow(row.date, {
      status: 'completed',
      score: session.score ?? 0,
      finished_at: session.finished_at ?? Date.now(),
    }) ?? row
  );
}

function parseSnapshotPoint(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { knowledge_point?: unknown };
    return typeof parsed.knowledge_point === 'string' ? parsed.knowledge_point.trim() : '';
  } catch {
    return '';
  }
}

export function dailyFocusPoints(): string[] {
  const weak = listMastery(DEFAULT_LEARNER)
    .filter((row) => row.probability < 0.85)
    .slice(0, 3)
    .map((row) => row.knowledge_point);
  const due = listWrongRecords(DEFAULT_LEARNER, true)
    .map((row) => parseSnapshotPoint(row.question_snapshot))
    .filter(Boolean);
  const points = [...new Set([...weak, ...due])].slice(0, 3);
  return points.length ? points : ['综合'];
}

function pickFromBank(points: string[], count: number, subject?: string): QuestionRow[] {
  const clauses = [`knowledge_point IN (${points.map(() => '?').join(',')})`];
  const values: (string | number)[] = [...points];
  if (subject) {
    clauses.push('subject = ?');
    values.push(subject);
  }
  return db
    .prepare(`SELECT * FROM questions WHERE ${clauses.join(' AND ')} ORDER BY RANDOM() LIMIT ?`)
    .all(...values, count) as unknown as QuestionRow[];
}

async function selectQuestions(points: string[], count: number, subject?: string): Promise<QuestionRow[]> {
  const selected = pickFromBank(points, count, subject);
  const seen = new Set(selected.map((row) => row.question_id));
  if (selected.length >= count) return selected.slice(0, count);

  const fillFromBank = (limit: number) => {
    if (limit <= 0) return;
    const rows = db
      .prepare('SELECT * FROM questions ORDER BY RANDOM() LIMIT ?')
      .all(limit) as unknown as QuestionRow[];
    for (const row of rows) {
      if (seen.has(row.question_id)) continue;
      selected.push(row);
      seen.add(row.question_id);
    }
  };

  // 题库里已有题目时优先复用，避免每日练习因生成模型而变慢
  fillFromBank(count - selected.length);
  if (selected.length >= count) return selected.slice(0, count);

  try {
    const generated = await generateQuiz({
      knowledgePoint: points[0] ?? '综合',
      count: count - selected.length,
      subject,
    });
    for (const row of generated) {
      if (seen.has(row.question_id)) continue;
      selected.push(row);
      seen.add(row.question_id);
    }
  } catch {
    // 生成失败时保留题库已有题目
  }
  fillFromBank(count - selected.length);
  return selected.slice(0, count);
}

function toDailyQuestion(row: QuestionRow): DailyQuestion {
  const { answer: _answer, explanation: _explanation, ...rest } = publicQuestion(row);
  return rest;
}

function questionsForSession(sessionId: string): DailyQuestion[] {
  return sessionQuestionIds(sessionId)
    .map((id) => getQuestion(id))
    .filter((row): row is QuestionRow => Boolean(row))
    .map(toDailyQuestion);
}

function answeredIds(sessionId: string): string[] {
  return (
    db.prepare('SELECT question_id FROM quiz_answers WHERE session_id = ?').all(sessionId) as unknown as {
      question_id: string;
    }[]
  ).map((row) => row.question_id);
}

export function dailyStreak(date = isoDate()): number {
  const rows = db
    .prepare("SELECT date FROM daily_practices WHERE learner_id = ? AND status = 'completed' ORDER BY date DESC LIMIT 400")
    .all(DEFAULT_LEARNER) as unknown as { date: string }[];
  const completed = new Set(rows.map((row) => row.date));
  let cursor = date;
  if (!completed.has(cursor)) cursor = previousDate(cursor, 1);
  let streak = 0;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = previousDate(cursor, 1);
  }
  return streak;
}

export function dailyHistory(limit = 7): DailyHistoryItem[] {
  return db
    .prepare(
      `SELECT date, status, score, total FROM daily_practices
       WHERE learner_id = ? ORDER BY date DESC LIMIT ?`,
    )
    .all(DEFAULT_LEARNER, limit) as unknown as DailyHistoryItem[];
}

export function getDailyOverview(): DailyOverview {
  const date = isoDate();
  const row = getRow(date);
  const practice = row ? syncStatus(row) : null;
  return {
    practice,
    questions: practice?.status === 'active' ? questionsForSession(practice.session_id) : [],
    answered_ids: practice?.status === 'active' ? answeredIds(practice.session_id) : [],
    streak: dailyStreak(date),
    history: dailyHistory(),
    recommendation: {
      focus_points: dailyFocusPoints(),
      due_wrong: listWrongRecords(DEFAULT_LEARNER, true).length,
    },
  };
}

export async function startDaily(subject?: string): Promise<StartDailyResult> {
  const date = isoDate();
  const existing = getRow(date);
  if (existing) {
    const practice = syncStatus(existing);
    return {
      practice,
      questions: practice.status === 'active' ? questionsForSession(practice.session_id) : [],
      answered_ids: practice.status === 'active' ? answeredIds(practice.session_id) : [],
      reused: true,
      streak: dailyStreak(date),
    };
  }

  const points = dailyFocusPoints();
  const questions = await selectQuestions(points, dailyCount(), subject?.trim() || undefined);
  if (questions.length === 0) {
    throw new DailyError('DAILY_NO_QUESTIONS', '题库暂无可抽取的题目，请先在智能出题生成题目或从资料提取题库', 422);
  }
  const sessionId = startSession({
    type: 'practice',
    title: `每日练习 · ${date}`,
    subject: subject?.trim() || undefined,
    questionIds: questions.map((row) => row.question_id),
  });
  const now = Date.now();
  db.prepare(
    `INSERT INTO daily_practices (date, learner_id, session_id, total, status, score, created_at, finished_at)
     VALUES (?, ?, ?, ?, 'active', NULL, ?, NULL)`,
  ).run(date, DEFAULT_LEARNER, sessionId, questions.length, now);
  return {
    practice: getRow(date)!,
    questions: questions.map(toDailyQuestion),
    answered_ids: [],
    reused: false,
    streak: dailyStreak(date),
  };
}

export function answerDaily(questionId: string, answer: string): AnswerDailyResult {
  const date = isoDate();
  const row = getRow(date);
  if (!row) throw new DailyError('DAILY_NOT_STARTED', '今天还没有开始每日练习', 404);
  const practice = syncStatus(row);
  if (practice.status === 'completed') {
    throw new DailyError('DAILY_COMPLETED', '今天的每日练习已经完成', 409);
  }
  const ids = sessionQuestionIds(practice.session_id);
  if (!ids.includes(questionId)) {
    throw new DailyError('DAILY_QUESTION_NOT_FOUND', '这道题不属于今天的每日练习', 404);
  }
  const answered = db
    .prepare('SELECT 1 FROM quiz_answers WHERE session_id = ? AND question_id = ?')
    .get(practice.session_id, questionId);
  if (answered) throw new DailyError('DAILY_QUESTION_ANSWERED', '这道题已经作答', 409);

  const result = answerQuestion(practice.session_id, questionId, answer);
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM quiz_answers WHERE session_id = ?`,
    )
    .get(practice.session_id) as { total: number; correct: number };
  const completed = counts.total >= practice.total;
  let updated = practice;
  if (completed) {
    const score = practice.total > 0 ? Number(((counts.correct / practice.total) * 100).toFixed(1)) : 0;
    db.prepare(
      "UPDATE quiz_sessions SET status = 'finished', score = ?, finished_at = ? WHERE session_id = ?",
    ).run(score, Date.now(), practice.session_id);
    updated =
      updateRow(practice.date, { status: 'completed', score, finished_at: Date.now() }) ?? practice;
  }
  return {
    result,
    practice: updated,
    streak: dailyStreak(date),
    completed,
  };
}
