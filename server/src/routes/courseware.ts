import { Hono } from 'hono';
import { deleteCourseware, generateCourseware, getCourseware, listCourseware } from '../courseware/service.ts';

const courseware = new Hono();

courseware.get('/', (c) => c.json({ items: listCourseware() }));

courseware.post('/', async (c) => {
  const body = await c.req.json<{ topic?: string; subject?: string }>().catch(() => null);
  const topic = body?.topic?.trim();
  if (!topic) return c.json({ error: 'topic 不能为空' }, 400);
  try {
    const row = await generateCourseware({ topic, subject: body?.subject });
    const { html: _html, ...meta } = row;
    return c.json({ ...meta, url: `/api/courseware/${row.courseware_id}` });
  } catch (e) {
    return c.json({ code: 'COURSEWARE_FAILED', message: e instanceof Error ? e.message : String(e) }, 502);
  }
});

courseware.get('/:id', (c) => {
  const row = getCourseware(c.req.param('id'));
  if (!row) return c.json({ error: '课件不存在' }, 404);
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(row.html);
});

courseware.delete('/:id', (c) => {
  deleteCourseware(c.req.param('id'));
  return c.json({ deleted: c.req.param('id') });
});

export default courseware;