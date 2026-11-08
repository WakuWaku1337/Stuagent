import { Hono } from 'hono';
import { getLegacyCourseware } from '../courseware/legacy.ts';
import { deleteUnifiedVisualization, listUnifiedVisualizations } from '../learning/visualize.ts';
import { generateVisualization } from '../learning/visualize-engine.ts';

const courseware = new Hono();

courseware.get('/', (c) => c.json({ items: listUnifiedVisualizations() }));

courseware.post('/', async (c) => {
  const body = await c.req.json<{ topic?: string; subject?: string }>().catch(() => null);
  const topic = body?.topic?.trim();
  if (!topic) return c.json({ error: 'topic 不能为空' }, 400);
  try {
    const result = await generateVisualization({ question: topic, subject: body?.subject });
    if (!result) return c.json({ error: '该主题不需要可视化' }, 422);
    return c.json({ ...result.visualization, url: `/visualize?id=${result.visualization.visualization_id}` }, 201);
  } catch (e) {
    return c.json({ code: 'COURSEWARE_FAILED', message: e instanceof Error ? e.message : String(e) }, 502);
  }
});

courseware.get('/:id', (c) => {
  const row = getLegacyCourseware(c.req.param('id'));
  if (!row) return c.json({ error: '课件不存在或已迁移为统一可视化' }, 404);
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(row.html);
});

courseware.delete('/:id', (c) => {
  const deleted = deleteUnifiedVisualization(c.req.param('id'));
  return deleted
    ? c.json({ deleted: c.req.param('id') })
    : c.json({ code: 'VIZ_NOT_FOUND', message: '可视化不存在' }, 404);
});

export default courseware;