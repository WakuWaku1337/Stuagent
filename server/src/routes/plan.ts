import { Hono, type Context } from 'hono';
import {
  PlanError,
  archivePlan,
  createPlan,
  deletePlan,
  getPlanOverview,
  planStats,
  togglePlanTask,
  updatePlan,
} from '../learning/plan.ts';

const plan = new Hono();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof PlanError) {
    return c.json({ code: error.code, message: error.message }, error.status as 400);
  }
  return c.json({ code: 'PLAN_ERROR', message: error instanceof Error ? error.message : String(error) }, 500);
}

plan.get('/', (c) => {
  const overview = getPlanOverview();
  return c.json({
    ...overview,
    stats: overview.plan ? planStats(overview.plan) : null,
  });
});

plan.post('/generate', async (c) => {
  const body = await c.req
    .json<{ goal?: string; days?: number; dailyMinutes?: number; subjects?: string[] }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', message: '请求体必须是 JSON' }, 400);
  try {
    const created = createPlan({
      goal: body.goal ?? '',
      days: body.days,
      dailyMinutes: body.dailyMinutes,
      subjects: body.subjects,
    });
    return c.json({ plan: created, stats: planStats(created) }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

plan.put('/:id', async (c) => {
  const body = await c.req
    .json<{ goal?: string; days?: number; dailyMinutes?: number; subjects?: string[] }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', message: '请求体必须是 JSON' }, 400);
  try {
    const updated = updatePlan(c.req.param('id'), body);
    return c.json({ plan: updated, stats: planStats(updated) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

plan.put('/:id/tasks/:taskId', async (c) => {
  const body = await c.req.json<{ done?: boolean }>().catch(() => null);
  if (!body || typeof body.done !== 'boolean') {
    return c.json({ code: 'INVALID_DONE', message: 'done 必须是布尔值' }, 400);
  }
  try {
    const updated = togglePlanTask(c.req.param('id'), c.req.param('taskId'), body.done);
    return c.json({ plan: updated, stats: planStats(updated) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

plan.post('/:id/archive', (c) => {
  try {
    const archived = archivePlan(c.req.param('id'));
    return c.json({ plan: archived });
  } catch (error) {
    return errorResponse(c, error);
  }
});

plan.delete('/:id', (c) => {
  const deleted = deletePlan(c.req.param('id'));
  return deleted ? c.json({ deleted: c.req.param('id') }) : c.json({ code: 'PLAN_NOT_FOUND', message: '学习计划不存在' }, 404);
});

export default plan;
