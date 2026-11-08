import { Hono, type Context } from 'hono';
import {
  DailyError,
  answerDaily,
  dailyHistory,
  dailyStreak,
  getDailyOverview,
  startDaily,
} from '../learning/daily.ts';

const daily = new Hono();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof DailyError) {
    return c.json({ code: error.code, message: error.message }, error.status as 400);
  }
  return c.json(
    { code: 'DAILY_ERROR', message: error instanceof Error ? error.message : String(error) },
    500,
  );
}

daily.get('/', (c) => c.json(getDailyOverview()));

daily.get('/history', (c) => c.json({ history: dailyHistory(14), streak: dailyStreak() }));

daily.post('/start', async (c) => {
  const body = await c.req.json<{ subject?: string }>().catch(() => null);
  try {
    const result = await startDaily(body?.subject);
    return c.json(result, result.reused ? 200 : 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

daily.post('/answer', async (c) => {
  const body = await c.req.json<{ question_id?: string; answer?: string }>().catch(() => null);
  if (!body?.question_id || !body.answer) {
    return c.json({ code: 'INVALID_ANSWER', message: 'question_id 与 answer 必填' }, 400);
  }
  try {
    return c.json(answerDaily(body.question_id, body.answer));
  } catch (error) {
    return errorResponse(c, error);
  }
});

export default daily;
