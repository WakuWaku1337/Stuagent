import { Hono } from 'hono';
import { db } from '../store.ts';
import { extractBankFromDocument, generateQuiz, listSessions, recommendDifficulty, sessionInfo, startSession, submitSession } from '../learning/quiz.ts';
import { listBanks, listQuestions, pickRandomQuestions, publicQuestion } from '../learning/questions.ts';
import { deleteMemory, listMemories, recallMemories, writeMemory } from '../learning/memory.ts';
import { deleteWrongRecord, dueCount, listWrongRecords, reviewWrongRecord } from '../learning/wrongbook.ts';
import { DEFAULT_LEARNER } from '../learning/memory.ts';
import { listMastery } from '../learning/mastery.ts';
import { listChunks } from '../store.ts';

const learning = new Hono();

learning.get('/memory', (c) => c.json({ memories: listMemories() }));
learning.post('/memory', async (c) => {
  const body = await c.req.json<{ content?: string; type?: string }>().catch(() => null);
  if (!body?.content?.trim()) return c.json({ error: 'content 不能为空' }, 400);
  return c.json(writeMemory(body.content, body.type));
});
learning.get('/memory/recall', (c) => c.json({ memories: recallMemories(c.req.query('q') ?? '') }));
learning.delete('/memory/:id', (c) => {
  deleteMemory(c.req.param('id'));
  return c.json({ deleted: c.req.param('id') });
});

learning.get('/wrongbook', (c) => {
  const dueOnly = c.req.query('due') === '1';
  const records = listWrongRecords(DEFAULT_LEARNER, dueOnly).map((r) => ({
    ...r,
    question_snapshot: JSON.parse(r.question_snapshot),
  }));
  return c.json({ records, due: dueCount(DEFAULT_LEARNER) });
});
learning.post('/wrongbook/:id/review', async (c) => {
  const body = await c.req.json<{ quality?: number }>().catch(() => null);
  try {
    const row = reviewWrongRecord(c.req.param('id'), body?.quality ?? 4);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});
learning.delete('/wrongbook/:id', (c) => {
  deleteWrongRecord(c.req.param('id'));
  return c.json({ deleted: c.req.param('id') });
});

learning.get('/mastery', (c) => {
  const rows = listMastery(DEFAULT_LEARNER);
  return c.json({
    mastery: rows.map((r) => ({ ...r, percent: Math.round(r.probability * 1000) / 10, mastered: r.probability >= 0.95 })),
  });
});

learning.get('/quiz/difficulty', (c) => {
  const knowledgePoint = (c.req.query('knowledge_point') ?? '').trim();
  if (!knowledgePoint) return c.json({ error: 'knowledge_point 不能为空' }, 400);
  const recommendation = recommendDifficulty(knowledgePoint);
  return c.json({
    knowledge_point: knowledgePoint,
    ...recommendation,
    options: ['基础', '中等', '拔高'],
  });
});

learning.post('/quiz/generate', async (c) => {
  const body = await c.req
    .json<{ knowledge_point?: string; difficulty?: string; count?: number; subject?: string }>()
    .catch(() => null);
  if (!body?.knowledge_point?.trim()) return c.json({ error: 'knowledge_point 不能为空' }, 400);
  try {
    const questions = await generateQuiz({
      knowledgePoint: body.knowledge_point,
      difficulty: body.difficulty,
      count: body.count,
      subject: body.subject,
    });
    const recommendation = recommendDifficulty(body.knowledge_point);
    const applied =
      body.difficulty && body.difficulty !== 'auto' ? body.difficulty : recommendation.difficulty;
    const sessionId = startSession({
      type: 'practice',
      title: `${body.knowledge_point} 练习`,
      subject: body.subject,
      questionIds: questions.map((q) => q.question_id),
    });
    return c.json({
      session_id: sessionId,
      difficulty: applied,
      recommended_difficulty: recommendation.difficulty,
      mastery: recommendation.probability,
      questions: questions.map((q) => {
        const { answer: _a, explanation: _e, ...rest } = publicQuestion(q);
        return rest;
      }),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

learning.post('/quiz/answer', async (c) => {
  const body = await c.req.json<{ session_id?: string; question_id?: string; answer?: string }>().catch(() => null);
  if (!body?.session_id || !body.question_id || !body.answer) {
    return c.json({ error: 'session_id / question_id / answer 必填' }, 400);
  }
  try {
    const info = sessionInfo(body.session_id);
    if (!info) return c.json({ error: '测验不存在' }, 404);
    const result = await import('../learning/quiz.ts').then((m) => m.answerQuestion(body.session_id!, body.question_id!, body.answer!));
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

learning.get('/quiz/sessions', (c) => c.json({ sessions: listSessions() }));

learning.get('/bank', (c) => c.json({ banks: listBanks(), questions: listQuestions({ limit: 200 }).map(publicQuestion) }));

learning.post('/bank/extract', async (c) => {
  const body = await c.req.json<{ document_id?: string }>().catch(() => null);
  if (!body?.document_id) return c.json({ error: 'document_id 必填' }, 400);
  const chunks = listChunks(body.document_id);
  try {
    const result = await extractBankFromDocument(chunks);
    return c.json({ ...result, document_id: body.document_id });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

learning.post('/exam/start', async (c) => {
  const body = await c.req
    .json<{ bank_id?: string; subject?: string; count?: number; duration_min?: number }>()
    .catch(() => null);
  const count = Math.min(Math.max(body?.count ?? 5, 1), 50);
  const questions = pickRandomQuestions(count, body?.bank_id, body?.subject);
  if (questions.length === 0) return c.json({ error: '题库为空，请先出题或从资料提取题库' }, 400);
  const sessionId = startSession({
    type: 'mock',
    subject: body?.subject,
    durationMin: body?.duration_min ?? 20,
    questionIds: questions.map((q) => q.question_id),
  });
  return c.json({
    session_id: sessionId,
    duration_min: body?.duration_min ?? 20,
    questions: questions.map((q) => {
      const { answer: _a, explanation: _e, ...rest } = publicQuestion(q);
      return rest;
    }),
  });
});

learning.get('/exam/:sessionId', (c) => {
  const info = sessionInfo(c.req.param('sessionId'));
  if (!info) return c.json({ error: '测验不存在' }, 404);
  return c.json(info);
});

learning.post('/exam/:sessionId/submit', async (c) => {
  const body = await c.req.json<{ answers?: { question_id: string; answer: string }[] }>().catch(() => null);
  if (!body?.answers) return c.json({ error: 'answers 必填' }, 400);
  try {
    const result = submitSession(c.req.param('sessionId'), body.answers);
    const analysis = db
      .prepare(
        `SELECT knowledge_point, SUM(is_correct = 0) AS wrong, COUNT(*) AS total
         FROM quiz_answers qa JOIN questions q ON qa.question_id = q.question_id
         WHERE qa.session_id = ? GROUP BY knowledge_point ORDER BY wrong DESC`,
      )
      .all(c.req.param('sessionId'));
    return c.json({ ...result, analysis });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

export default learning;