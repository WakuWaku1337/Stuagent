import { Hono } from 'hono';
import {
  MediaError,
  getMedia,
  readMediaFile,
  saveImage,
  toAttachment,
} from '../media/service.ts';
import { runCleanup, storageStats, type CleanupMode } from '../storage/service.ts';
import { requireAdmin } from '../auth/middleware.ts';

const media = new Hono();

media.post('/upload', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ code: 'PARSE_FAILED', error: '无法解析上传表单' }, 422);
  }
  const raw = body.file;
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (item): item is File => item instanceof File,
  );
  if (files.length === 0) return c.json({ code: 'FILE_EMPTY', error: '缺少 file 字段' }, 400);
  if (files.length > 4) return c.json({ code: 'TOO_MANY_FILES', error: '一次最多上传 4 张图片' }, 400);

  const items = [];
  for (const file of files) {
    try {
      items.push(toAttachment(await saveImage(file)));
    } catch (e) {
      const error = e instanceof MediaError ? e : new MediaError('STORAGE_ERROR', String(e), 500);
      return c.json({ code: error.code, error: error.message }, error.status as 400);
    }
  }
  return c.json(items.length === 1 ? items[0] : { items }, 201);
});

media.get('/storage', requireAdmin, async (c) => c.json(await storageStats()));

media.post('/cleanup', requireAdmin, async (c) => {
  const body = await c.req
    .json<{ mode?: string; olderThanDays?: number; dryRun?: boolean }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', error: '请求体必须是 JSON' }, 400);
  const mode = body.mode ?? 'orphans';
  if (mode !== 'orphans' && mode !== 'retention') {
    return c.json({ code: 'INVALID_MODE', error: 'mode 必须是 orphans 或 retention' }, 400);
  }
  if (body.olderThanDays !== undefined) {
    if (!Number.isFinite(body.olderThanDays) || body.olderThanDays < 1 || body.olderThanDays > 3650) {
      return c.json({ code: 'INVALID_DAYS', error: 'olderThanDays 必须在 1~3650 之间' }, 400);
    }
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return c.json({ code: 'INVALID_DRY_RUN', error: 'dryRun 必须是布尔值' }, 400);
  }
  const result = await runCleanup({
    mode: mode as CleanupMode,
    olderThanDays: body.olderThanDays,
    dryRun: body.dryRun,
  });
  return c.json(result);
});

media.get('/:id', async (c) => {
  const row = getMedia(c.req.param('id'));
  if (!row) return c.json({ error: '图片不存在' }, 404);
  try {
    const buffer = await readMediaFile(row);
    const etag = `"${row.hash.slice(0, 20)}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.body(buffer, 200, {
      'Content-Type': row.mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': `inline; filename="${row.media_id}.${row.stored_name.split('.').pop()}"`,
    });
  } catch {
    return c.json({ error: '图片文件缺失' }, 404);
  }
});

export default media;
