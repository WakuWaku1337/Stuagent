import { Hono } from 'hono';
import { deleteDocument, listDocuments } from '../store.ts';
import {
  DocumentError,
  documentDetail,
  ingestFile,
  reparseDocument,
  type UploadResult,
} from '../documents/service.ts';
import { deleteBySource } from '../rag/milvus.ts';
import { indexDocument } from '../rag/service.ts';

const documents = new Hono();

function triggerIndex(documentId: string) {
  indexDocument(documentId).catch((e) => {
    console.error(`[index] ${documentId} 失败:`, e instanceof Error ? e.message : e);
  });
}

documents.post('/', async (c) => {
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

  const subject = typeof body.subject === 'string' ? body.subject : undefined;
  const tags = typeof body.tags === 'string' ? body.tags : undefined;

  const results: UploadResult[] = [];
  for (const file of files) {
    try {
      results.push(await ingestFile(file, { subject, tags }));
    } catch (e) {
      if (e instanceof DocumentError) {
        results.push({
          filename: file.name,
          status: 'failed',
          code: e.code,
          message: e.message,
          ...(e.detail as object),
        });
      } else {
        results.push({
          filename: file.name,
          status: 'failed',
          code: 'STORAGE_ERROR',
          message: e instanceof Error ? e.message : String(e),
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
});

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
    case 'INVALID_MIME':
      return 415;
    case 'PARSE_FAILED':
      return 422;
    default:
      return 500;
  }
}

export default documents;