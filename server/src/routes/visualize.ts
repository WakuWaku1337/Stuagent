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
import { manualConicDocument, manualFunctionDocument } from '../learning/viz/function-scene.ts';
import { documentFromLegacySpec } from '../learning/viz/document.ts';

const visualize = new Hono();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof VisualizationError) {
    return c.json({ code: error.code, message: error.message, diagnostics: error.diagnostics ?? [] }, error.status as 400);
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
    let visualization: ReturnType<typeof createVisualization>;
    if (body.type === 'function2d' || body.type === 'conic') {
      const spec = body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec)
        ? body.spec as Record<string, unknown>
        : null;
      const expression = typeof spec?.expression === 'string' ? spec.expression.trim() : '';
      if (!expression) {
        return c.json({ code: 'VIZ_EXPRESSION_INVALID', message: '手动函数需要 expression' }, 400);
      }
      const range = Array.isArray(spec?.range) && spec.range.length === 2
        ? [Number(spec.range[0]), Number(spec.range[1])] as [number, number]
        : undefined;
      const document = body.type === 'function2d'
        ? manualFunctionDocument({ expression, range, title: body.title })
        : manualConicDocument({ expression, range, title: body.title });
      visualization = createVisualization({
        type: body.type,
        title: document.title,
        spec: document,
        source: body.source ?? 'manual',
        schemaVersion: 2,
        inputText: document.input.text,
      });
    } else {
      const document = documentFromLegacySpec({
        type: body.type,
        title: body.title ?? '',
        spec: body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec)
          ? body.spec as Record<string, unknown>
          : {},
        inputText: body.title,
        generator: 'manual',
      });
      visualization = createVisualization({
        type: body.type,
        title: body.title ?? '',
        spec: document,
        source: body.source ?? 'manual',
        schemaVersion: 2,
        inputText: body.title,
      });
    }
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
    if (!result) {
      return c.json({
        code: 'VIZ_UNSUPPORTED_STRUCTURE',
        message: '未从题目中解析到可建模的图形结构；请补充方程、函数定义、点、尺寸或场景信息。',
        diagnostics: [{
          code: 'VIZ_UNSUPPORTED_STRUCTURE',
          severity: 'error',
          message: '未从题目中解析到可建模的图形结构',
        }],
      }, 422);
    }
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