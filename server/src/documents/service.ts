import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findDocumentByHash,
  getDocument,
  insertChunks,
  insertDocument,
  listChunks,
  updateDocument,
  type ChunkRow,
  type DocumentRow,
} from '../store.ts';
import { chunkBlocks } from './chunker.ts';
import { detectEncoding, parseDoc, parseDocx, parseMarkdown, parsePdf, parseText, type ParsedBlock } from './parsers.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const uploadDir = join(serverRoot, 'uploads');
mkdir(uploadDir, { recursive: true }).catch(() => {});

const MAX_SIZE = 50 * 1024 * 1024;
const ALLOWED = new Map<string, { mime: RegExp; parse: (buf: Buffer) => ParsedBlock[] | Promise<ParsedBlock[]> }>([
  ['.pdf', { mime: /^application\/pdf$/, parse: (b) => parsePdf(b) }],
  [
    '.docx',
    {
      mime: /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,
      parse: (b) => parseDocx(b),
    },
  ],
  ['.doc', { mime: /^(application\/msword|application\/octet-stream)$/, parse: (b) => parseDoc(b) }],
  ['.txt', { mime: /^text\/plain$/, parse: (b) => parseText(detectEncoding(b)) }],
  ['.md', { mime: /^(text\/markdown|text\/plain|application\/octet-stream)$/, parse: (b) => parseMarkdown(b.toString('utf8')) }],
  ['.markdown', { mime: /^(text\/markdown|text\/plain|application\/octet-stream)$/, parse: (b) => parseMarkdown(b.toString('utf8')) }],
]);

export interface UploadMeta {
  subject?: string;
  tags?: string;
}

export interface UploadResult {
  document_id?: string;
  filename: string;
  file_type?: string;
  chunk_count?: number;
  status: string;
  code?: string;
  message?: string;
}

export class DocumentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export function allowedTypes(): string[] {
  return [...ALLOWED.keys()].map((e) => e.slice(1));
}

export async function ingestFile(file: File, meta: UploadMeta): Promise<UploadResult> {
  const filename = file.name || 'unnamed';
  const ext = extname(filename).toLowerCase();
  const parser = ALLOWED.get(ext);

  if (!parser) {
    throw new DocumentError(400, 'FILE_TYPE_UNSUPPORTED', '不支持的文件类型', {
      filename,
      allowed: allowedTypes(),
    });
  }
  if (file.size === 0) throw new DocumentError(400, 'FILE_EMPTY', '空文件', { filename });
  if (file.size > MAX_SIZE) throw new DocumentError(413, 'FILE_TOO_LARGE', '超过大小限制', { filename, max: '50MB' });
  if (file.type && !parser.mime.test(file.type) && file.type !== 'application/octet-stream') {
    throw new DocumentError(415, 'INVALID_MIME', 'MIME 与扩展名不符', { filename, mime: file.type });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash('sha256').update(buffer).digest('hex');
  const existing = findDocumentByHash(hash);
  if (existing) {
    throw new DocumentError(409, 'DOCUMENT_EXISTS', '重复上传（哈希命中）', {
      filename,
      document_id: existing.document_id,
    });
  }

  const documentId = randomUUID();
  insertDocument({
    document_id: documentId,
    filename,
    file_type: ext.slice(1),
    size: buffer.length,
    hash,
    subject: meta.subject ?? null,
    tags: meta.tags ?? null,
    status: 'uploaded',
    chunk_count: 0,
    error: null,
  });

  try {
    await writeFile(join(uploadDir, `${documentId}${ext}`), buffer);
    const blocks = await parser.parse(buffer);
    if (blocks.length === 0) throw new Error('未提取到文本内容');
    const drafts = chunkBlocks(blocks);
    if (drafts.length === 0) throw new Error('切片结果为空');
    insertChunks(
      drafts.map((d, i) => ({
        chunk_id: `${documentId}-${String(i + 1).padStart(4, '0')}`,
        document_id: documentId,
        seq: i + 1,
        text: d.text,
        chapter: d.chapter || null,
        page: d.page ?? null,
        char_count: d.text.length,
      })),
    );
    updateDocument(documentId, { status: 'parsed', chunk_count: drafts.length });
    return {
      document_id: documentId,
      filename,
      file_type: ext.slice(1),
      chunk_count: drafts.length,
      status: 'parsed',
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    updateDocument(documentId, { status: 'failed', error: message });
    throw new DocumentError(422, 'PARSE_FAILED', '解析失败（损坏/加密/乱码）', { filename, reason: message });
  }
}

export async function reparseDocument(id: string): Promise<UploadResult> {
  const doc = getDocument(id);
  if (!doc) throw new DocumentError(404, 'DOCUMENT_NOT_FOUND', '文档不存在', { document_id: id });
  const ext = `.${doc.file_type}`;
  const parser = ALLOWED.get(ext);
  if (!parser) throw new DocumentError(400, 'FILE_TYPE_UNSUPPORTED', '不支持的文件类型', { file_type: doc.file_type });

  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(join(uploadDir, `${id}${ext}`));
  const blocks = await parser.parse(buffer);
  const drafts = chunkBlocks(blocks);
  const { db } = await import('../store.ts');
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
  insertChunks(
    drafts.map((d, i) => ({
      chunk_id: `${id}-${String(i + 1).padStart(4, '0')}`,
      document_id: id,
      seq: i + 1,
      text: d.text,
      chapter: d.chapter || null,
      page: d.page ?? null,
      char_count: d.text.length,
    })),
  );
  updateDocument(id, { status: 'parsed', chunk_count: drafts.length, error: null });
  return { document_id: id, filename: doc.filename, file_type: doc.file_type, chunk_count: drafts.length, status: 'parsed' };
}

export function documentDetail(id: string): { document: DocumentRow; chunks: ChunkRow[] } | undefined {
  const document = getDocument(id);
  if (!document) return undefined;
  return { document, chunks: listChunks(id) };
}