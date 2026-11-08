import { Hono, type Context } from 'hono';
import {
  VISUALIZATION_TYPES,
  VisualizationError,
  createVisualization,
  deleteUnifiedVisualization,
  getUnifiedVisualization,
  listUnifiedVisualizations,
  type VisualizationType,
} from '../learning/visualize.ts';
import { generateVisualization } from '../learning/visualize-engine.ts';

const visualize = new Hono();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof VisualizationError) {
    return c.json({ code: error.code, message: error.message }, error.status as 400);
  }
  return c.json(
    { code: 'VISUALIZE_ERROR', message: error instanceof Error ? error.message : String(error) },
    500,
  );
}

visualize.get('/', (c) => {
  const type = c.req.query('type') as VisualizationType | undefined;
  if (type && !VISUALIZATION_TYPES.includes(type)) {
    return c.json({ code: 'VIZ_TYPE_INVALID', message: '不支持的可视化类型' }, 400);
  }
  return c.json({ visualizations: listUnifiedVisualizations(type) });
});

visualize.get('/:id', (c) => {
  const item = getUnifiedVisualization(c.req.param('id'));
  return item
    ? c.json({ visualization: item })
    : c.json({ code: 'VIZ_NOT_FOUND', message: '可视化不存在' }, 404);
});

visualize.post('/', async (c) => {
  const body = await c.req
    .json<{ type?: VisualizationType; title?: string; spec?: unknown; source?: string }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', message: '请求体必须是 JSON' }, 400);
  if (!body.type || !VISUALIZATION_TYPES.includes(body.type)) {
    return c.json({ code: 'VIZ_TYPE_INVALID', message: 'type 不是支持的可视化类型' }, 400);
  }
  try {
    const visualization = createVisualization({
      type: body.type,
      title: body.title ?? '',
      spec: body.spec,
      source: body.source ?? 'manual',
    });
    return c.json({ visualization }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

visualize.post('/generate', async (c) => {
  const body = await c.req.json<{ question?: string; subject?: string }>().catch(() => null);
  const question = body?.question?.trim();
  if (!question) return c.json({ code: 'VIZ_QUESTION_REQUIRED', message: 'question 不能为空' }, 400);
  try {
    const result = await generateVisualization({ question, subject: body?.subject });
    if (!result) return c.json({ visualization: null, matched: 'none' });
    return c.json(result, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

visualize.delete('/:id', (c) => {
  const deleted = deleteUnifiedVisualization(c.req.param('id'));
  return deleted
    ? c.json({ deleted: c.req.param('id') })
    : c.json({ code: 'VIZ_NOT_FOUND', message: '可视化不存在' }, 404);
});

export default visualize;