import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { bktUpdate, DEFAULT_BKT } from './bkt.ts';
import { chatJson } from './llm.ts';
import { getMastery, saveMastery } from './mastery.ts';
import { currentLearnerId } from './context.ts';
import { getQuestion, publicQuestion, saveQuestions, type QuestionRow } from './questions.ts';
import { addWrongRecord } from './wrongbook.ts';

export interface GeneratedQuestion {
  stem: string;
  options: { A: string; B: string; C: string; D: string };
  answer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  knowledge_point?: string;
}

export type Difficulty = '基础' | '中等' | '拔高';

/** 难度校准：掌握度低先补基础，稳定后再拔高。 */
export function recommendDifficulty(knowledgePoint: string): {
  difficulty: Difficulty;
  probability: number | null;
  reason: string;
} {
  const row = getMastery(currentLearnerId(), knowledgePoint);
  if (!row) {
    return { difficulty: '中等', probability: null, reason: '暂无该知识点的掌握度数据，先从中等难度开始' };
  }
  const percent = Math.round(row.probability * 1000) / 10;
  if (row.probability < 0.5) {
    return { difficulty: '基础', probability: percent, reason: `掌握度 ${percent}%，先用基础题巩固概念` };
  }
  if (row.probability < 0.75) {
    return { difficulty: '中等', probability: percent, reason: `掌握度 ${percent}%，用中等题检验迁移` };
  }
  return { difficulty: '拔高', probability: percent, reason: `掌握度 ${percent}%，可以尝试拔高题` };
}

export async function generateQuiz(input: {
  knowledgePoint: string;
  difficulty?: string;
  count?: number;
  subject?: string;
  signal?: AbortSignal;
}): Promise<QuestionRow[]> {
  // watchdog 触发后不再发起模型调用；已发出的云端推理不可撤回，只能中止本地等待与后续步骤。
  if (input.signal?.aborted) throw new DOMException('出题任务已取消', 'AbortError');
  const count = Math.min(Math.max(input.count ?? 3, 1), 10);
  const recommended = recommendDifficulty(input.knowledgePoint);
  const difficulty =
    input.difficulty && input.difficulty !== 'auto' ? input.difficulty : recommended.difficulty;
  const result = await chatJson<{ questions: GeneratedQuestion[] }>([
    {
      role: 'system',
      content:
        '你是高中出题老师。只输出 JSON，格式：{"questions":[{"stem":"题干","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"解析","knowledge_point":"知识点"}]}。题目为单选题，选项必须互斥，答案唯一。',
    },
    {
      role: 'user',
      content: `请围绕知识点「${input.knowledgePoint}」出 ${count} 道${difficulty}难度的单选题${input.subject ? `，学科：${input.subject}` : ''}。`,
    },
  ], { scenario: 'quiz', subject: input.subject, signal: input.signal });
  if (input.signal?.aborted) throw new DOMException('出题任务已取消', 'AbortError');
  const items = result.questions ?? [];
  if (items.length === 0) throw new Error('模型未返回题目');
  return saveQuestions(items, {
    bankId: 'generated',
    subject: input.subject,
    knowledgePoint: input.knowledgePoint,
    difficulty,
    source: 'quiz.generate',
  });
}

export async function extractBankFromDocument(chunks: { text: string }[]): Promise<{ bankId: string; count: number }> {
  if (chunks.length === 0) throw new Error('文档没有可用切片');
  const content = chunks
    .map((c) => c.text)
    .join('\n\n')
    .slice(0, 4000);
  const bankId = `bank-${randomUUID().slice(0, 8)}`;
  const result = await chatJson<{ questions: GeneratedQuestion[] }>([
    {
      role: 'system',
      content:
        '你是题库整理助手。从给定资料中提取选择题，只输出 JSON：{"questions":[{"stem":"题干","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"解析","knowledge_point":"知识点"}]}。资料中找不到选择题就基于内容出单选题，不要编造无关题目。',
    },
    { role: 'user', content: `资料内容：\n${content}` },
  ], { scenario: 'quiz' });
  const items = result.questions ?? [];
  if (items.length === 0) throw new Error('未能从资料中提取到题目');
  saveQuestions(items, {
    bankId,
    knowledgePoint: '综合',
    difficulty: '中等',
    source: bankId,
  });
  return { bankId, count: items.length };
}

export function startSession(input: {
  type: 'practice' | 'mock';
  title?: string;
  subject?: string;
  durationMin?: number;
  questionIds: string[];
}): string {
  const sessionId = randomUUID();
  db.prepare(
    `INSERT INTO quiz_sessions (session_id, learner_id, type, title, subject, total, duration_min, status, started_at, question_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    sessionId,
    currentLearnerId(),
    input.type,
    input.title ?? (input.type === 'mock' ? '模拟考试' : '随堂练习'),
    input.subject ?? null,
    input.questionIds.length,
    input.durationMin ?? null,
    Date.now(),
    JSON.stringify(input.questionIds),
  );
  return sessionId;
}

export function sessionQuestionIds(sessionId: string): string[] {
  const row = db
    .prepare('SELECT question_ids FROM quiz_sessions WHERE session_id = ? AND learner_id = ?')
    .get(sessionId, currentLearnerId()) as
    | { question_ids: string | null }
    | undefined;
  if (!row?.question_ids) return [];
  try {
    return JSON.parse(row.question_ids) as string[];
  } catch {
    return [];
  }
}

export function sessionInfo(sessionId: string) {
  const row = db
    .prepare('SELECT * FROM quiz_sessions WHERE session_id = ? AND learner_id = ?')
    .get(sessionId, currentLearnerId()) as
    | {
        session_id: string;
        type: string;
        title: string;
        subject: string | null;
        total: number;
        score: number | null;
        duration_min: number | null;
        status: string;
        started_at: number;
        finished_at: number | null;
      }
    | undefined;
  if (!row) return undefined;
  const ids = sessionQuestionIds(sessionId);
  const questions = ids.map((id) => getQuestion(id)).filter((q): q is QuestionRow => Boolean(q));
  return { ...row, questions: questions.map(publicQuestion) };
}

export function updateMastery(knowledgePoint: string, correct: boolean): number {
  const row = getMastery(currentLearnerId(), knowledgePoint);
  const prior = row?.probability ?? DEFAULT_BKT.pL0;
  const next = bktUpdate(prior, correct);
  saveMastery({
    learner_id: currentLearnerId(),
    knowledge_point: knowledgePoint,
    probability: next,
    correct_count: (row?.correct_count ?? 0) + (correct ? 1 : 0),
    wrong_count: (row?.wrong_count ?? 0) + (correct ? 0 : 1),
    updated_at: Date.now(),
  });
  return next;
}

export interface GradeResult {
  question_id: string;
  is_correct: boolean;
  correct_answer: string;
  student_answer: string;
  explanation: string | null;
  knowledge_point: string;
  mastery: number;
  wrong_record_id?: string;
}

export function answerQuestion(
  sessionId: string,
  questionId: string,
  studentAnswer: string,
): GradeResult {
  const owned = db
    .prepare('SELECT 1 FROM quiz_sessions WHERE session_id = ? AND learner_id = ?')
    .get(sessionId, currentLearnerId());
  if (!owned) throw new Error('测验不存在');
  const question = getQuestion(questionId);
  if (!question) throw new Error('题目不存在');
  const isCorrect = studentAnswer.trim().toUpperCase() === question.answer.trim().toUpperCase();
  db.prepare(
    `INSERT INTO quiz_answers (answer_id, session_id, question_id, student_answer, is_correct, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), sessionId, questionId, studentAnswer, isCorrect ? 1 : 0, Date.now());

  const probability = updateMastery(question.knowledge_point, isCorrect);
  let wrongRecordId: string | undefined;
  if (!isCorrect) {
    const record = addWrongRecord({
      learnerId: currentLearnerId(),
      questionId,
      snapshot: {
        content: question.content,
        options: JSON.parse(question.options),
        answer: question.answer,
        explanation: question.explanation,
        knowledge_point: question.knowledge_point,
        difficulty: question.difficulty,
      },
      studentAnswer,
      reason: '知识点薄弱',
    });
    wrongRecordId = record.record_id;
  }

  return {
    question_id: questionId,
    is_correct: isCorrect,
    correct_answer: question.answer,
    student_answer: studentAnswer,
    explanation: question.explanation,
    knowledge_point: question.knowledge_point,
    mastery: probability,
    wrong_record_id: wrongRecordId,
  };
}

export function submitSession(
  sessionId: string,
  answers: { question_id: string; answer: string }[],
): {
  session_id: string;
  total: number;
  correct: number;
  score: number;
  results: GradeResult[];
} {
  const info = sessionInfo(sessionId);
  if (!info) throw new Error('测验不存在');
  if (info.status === 'finished') throw new Error('该测验已交卷');
  const results = answers.map((a) => answerQuestion(sessionId, a.question_id, a.answer));
  const correct = results.filter((r) => r.is_correct).length;
  const score = info.total > 0 ? Number(((correct / info.total) * 100).toFixed(1)) : 0;
  db.prepare("UPDATE quiz_sessions SET status = 'finished', score = ?, finished_at = ? WHERE session_id = ? AND learner_id = ?").run(
    score,
    Date.now(),
    sessionId,
    currentLearnerId(),
  );
  return { session_id: sessionId, total: info.total, correct, score, results };
}

export function listSessions(limit = 20) {
  return db
    .prepare(
      'SELECT session_id, type, title, subject, total, score, status, started_at, finished_at FROM quiz_sessions WHERE learner_id = ? ORDER BY started_at DESC LIMIT ?',
    )
    .all(currentLearnerId(), limit);
}