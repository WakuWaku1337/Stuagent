import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-docs-'));
const uploadsDir = await mkdtemp(join(tmpdir(), 'edupi-uploads-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.EDU_UPLOADS_DIR = uploadsDir;

const { db, getDocument, listChunks } = await import('../src/store.ts');
const { ingestFile, normalizeSourcePath } = await import('../src/documents/service.ts');
const { MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_FILE_BYTES } = await import('../src/documents/limits.ts');

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

try {
  report(
    normalizeSourcePath('../数学/./函数/../函数/lesson.txt', 'fallback.txt') === '数学/函数/lesson.txt',
    'normalize relative source path',
    normalizeSourcePath('../数学/./函数/../函数/lesson.txt', 'fallback.txt'),
  );
  report(normalizeSourcePath('', 'fallback.txt') === 'fallback.txt', 'fallback source path');

  report(
    MAX_FILE_BYTES === 50 * 1024 * 1024 &&
      MAX_BATCH_FILES === 50 &&
      MAX_BATCH_BYTES === 200 * 1024 * 1024,
    'upload limits are 50MB / 50 files / 200MB',
  );
  let tooLarge: { code?: string; detail?: unknown } | null = null;
  try {
    await ingestFile(
      new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'too-large.pdf', { type: 'application/pdf' }),
      {},
    );
  } catch (error) {
    tooLarge = error as { code?: string; detail?: { max?: string } };
  }
  report(
    tooLarge?.code === 'FILE_TOO_LARGE' && (tooLarge.detail as { max?: string })?.max === '50MB',
    'file over 50MB rejected with detail.max',
  );
  const first = await ingestFile(
    new File(['函数是描述两个变量之间关系的规则。\n定义域与值域需要重点关注。'], 'lesson1.txt', {
      type: 'text/plain',
    }),
    { subject: '数学', sourcePath: '数学/函数/lesson1.txt' },
  );
  const second = await ingestFile(
    new File(['# 函数图像\n\n一次函数的图像是一条直线。'], 'lesson2.md', {
      type: 'text/markdown',
    }),
    { subject: '数学', sourcePath: '数学/函数/lesson2.md' },
  );
  report(
    first.status === 'parsed' && first.source_path === '数学/函数/lesson1.txt',
    'ingest first folder file',
    `${first.chunk_count} chunks`,
  );
  report(
    second.status === 'parsed' && second.source_path === '数学/函数/lesson2.md',
    'ingest second folder file',
    `${second.chunk_count} chunks`,
  );

  const doc = getDocument(first.document_id!);
  report(doc?.source_path === '数学/函数/lesson1.txt', 'document row keeps source_path');

  const chunks = listChunks(first.document_id!);
  report(
    chunks.length > 0 && chunks.every((chunk) => (chunk.chapter ?? '').startsWith('数学 / 函数')),
    'chunk chapter carries folder metadata',
    chunks[0]?.chapter ?? 'none',
  );

  const secondChunks = listChunks(second.document_id!);
  report(
    secondChunks.length > 0 && secondChunks.every((chunk) => (chunk.chapter ?? '').startsWith('数学 / 函数')),
    'markdown folder metadata',
    secondChunks[0]?.chapter ?? 'none',
  );

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(uploadsDir, { recursive: true, force: true });
}
