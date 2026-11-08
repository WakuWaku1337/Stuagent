import { Hono, type Context } from 'hono';
import { deleteDocument, listDocuments } from '../store.ts';
import {
  DocumentError,
  documentDetail,
  ingestFile,
  normalizeSourcePath,
  removeDocumentFile,
  reparseDocument,
  type UploadResult,
} from '../documents/service.ts';
import { deleteBySource } from '../rag/milvus.ts';
import { indexDocument } from '../rag/service.ts';

const documents = new Hono();
const MAX_BATCH_FILES = 50;
const MAX_BATCH_BYTES = 200 * 1024 * 1024;

function triggerIndex(documentId: string) {
  indexDocument(documentId).catch((e) => {
    console.error(`[index] ${documentId} 失败:`, e instanceof Error ? e.message : e);
  });
}

async function handleUpload(c: Context) {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ code: 'PARSE_FAILED', message: '无法解析上传表单' }, 422);
  }

  const rawFiles = body.file;
  const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).filter(
    (f): f is File => f instanceof File,
  );
  if (files.length === 0) return c.json({ code: 'FILE_EMPTY', message: '缺少 file 字段' }, 400);
  if (files.length > MAX_BATCH_FILES) {
    return c.json(
      { code: 'BATCH_TOO_MANY_FILES', message: `单次最多上传 ${MAX_BATCH_FILES} 个文件，请分批导入` },
      400,
    );
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    return c.json(
      { code: 'BATCH_TOO_LARGE', message: `单次上传总大小不能超过 ${MAX_BATCH_BYTES / 1024 / 1024}MB，请分批导入` },
      413,
    );
  }

  const subject = typeof body.subject === 'string' ? body.subject : undefined;
  const tags = typeof body.tags === 'string' ? body.tags : undefined;
  let paths: string[] = [];
  if (typeof body.paths === 'string') {
    try {
      const parsed = JSON.parse(body.paths);
      if (Array.isArray(parsed)) {
        paths = parsed.map((item) => (typeof item === 'string' ? item : ''));
      }
    } catch {
      paths = [];
    }
  }

  const results: UploadResult[] = [];
  for (const [index, file] of files.entries()) {
    const sourcePath = normalizeSourcePath(paths[index], file.name);
    try {
      results.push(await ingestFile(file, { subject, tags, sourcePath }));
    } catch (e) {
      if (e instanceof DocumentError) {
        results.push({
          filename: file.name,
          status: 'failed',
          code: e.code,
          message: e.message,
          source_path: sourcePath,
          ...(e.detail as object),
        });
      } else {
        results.push({
          filename: file.name,
          status: 'failed',
          code: 'STORAGE_ERROR',
          message: e instanceof Error ? e.message : String(e),
          source_path: sourcePath,
        });
      }
    }
  }

  if (files.length === 1) {
    const r = results[0];
    if (r.document_id && r.status === 'parsed') triggerIndex(r.document_id);
    const status = r.status === 'failed' ? failureStatus(r.code) : 200;
    return c.json(r, status as 200);
  }
  for (const r of results) {
    if (r.document_id && r.status === 'parsed') triggerIndex(r.document_id);
  }
  return c.json({ results }, 207);
}

documents.post('/', handleUpload);
documents.post('/batch', handleUpload);

documents.get('/', (c) => {
  const docs = listDocuments().map(({ hash: _hash, ...rest }) => rest);
  return c.json({ documents: docs });
});

documents.get('/:id', (c) => {
  const detail = documentDetail(c.req.param('id'));
  if (!detail) return c.json({ code: 'DOCUMENT_NOT_FOUND', message: '文档不存在' }, 404);
  return c.json(detail);
});

documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const detail = documentDetail(id);
  if (!detail) return c.json({ code: 'DOCUMENT_NOT_FOUND', message: '文档不存在' }, 404);
  await deleteBySource(id).catch(() => {});
  deleteDocument(id);
  await removeDocumentFile(detail.document);
  return c.json({ deleted: id });
});

documents.post('/:id/index', async (c) => {
  const id = c.req.param('id');
  if (!documentDetail(id)) return c.json({ code: 'DOCUMENT_NOT_FOUND', message: '文档不存在' }, 404);
  try {
    const chunks = await indexDocument(id);
    return c.json({ document_id: id, status: 'indexed', chunk_count: chunks });
  } catch (e) {
    return c.json({ code: 'INDEX_FAILED', message: e instanceof Error ? e.message : String(e) }, 502);
  }
});

documents.post('/:id/reparse', async (c) => {
  try {
    const result = await reparseDocument(c.req.param('id'));
    if (result.document_id) triggerIndex(result.document_id);
    return c.json(result);
  } catch (e) {
    if (e instanceof DocumentError) {
      return c.json({ code: e.code, message: e.message, detail: e.detail }, e.status as 400);
    }
    return c.json({ code: 'PARSE_FAILED', message: e instanceof Error ? e.message : String(e) }, 422);
  }
});

function failureStatus(code?: string): number {
  switch (code) {
    case 'FILE_TYPE_UNSUPPORTED':
    case 'FILE_EMPTY':
      return 400;
    case 'DOCUMENT_EXISTS':
      return 409;
    case 'FILE_TOO_LARGE':
      return 413;
    case 'STORAGE_QUOTA_EXCEEDED':
      return 507;
    case 'INVALID_MIME':
      return 415;
    case 'PARSE_FAILED':
      return 422;
    default:
      return 500;
  }
}

export default documents;