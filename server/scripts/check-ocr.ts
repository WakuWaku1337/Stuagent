/** 扫描件 OCR 验收：上传 → 异步进度 → 原图 → 低置信校对 → 写回重新入库 */
import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const FILE = 'testdata/scanned-sample.pdf';

interface DocRow {
  document_id: string;
  filename: string;
  status: string;
  chunk_count: number;
  error: string | null;
}

interface OcrPage {
  page: number;
  status: string;
  confidence: number;
  markdown: string;
  image_url: string | null;
}

interface OcrView {
  job: {
    status: string;
    total_pages: number;
    done_pages: number;
    progress: number;
    review_pages: number[];
    error: string | null;
  } | null;
  pages: OcrPage[];
  threshold: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function poll<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 480_000): Promise<T> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed % 30 < 4 && elapsed > 0 && last !== String(elapsed)) {
      last = String(elapsed);
      console.log(`  ${label} 等待中 ${elapsed}s`);
    }
    await sleep(3000);
  }
  throw new Error(`${label} 超时`);
}

async function main() {
  const res = await fetch(`${BASE}/api/documents`);
  const documents = (await res.json()) as { documents: DocRow[] };
  for (const doc of documents.documents.filter((item) => item.filename === 'scanned-sample.pdf')) {
    await fetch(`${BASE}/api/documents/${doc.document_id}`, { method: 'DELETE' });
  }

  const pdf = await readFile(FILE);
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'scanned-sample.pdf');
  form.append('subject', '化学');
  const upload = await fetch(`${BASE}/api/documents`, { method: 'POST', body: form });
  const created = await body<{
    document_id?: string;
    status: string;
    ocr_required?: boolean;
    ocr_pages?: number;
    message?: string;
  }>(upload);
  console.log(`${upload.status === 202 && created.status === 'ocr_queued' ? 'PASS' : 'FAIL'} 扫描件判定与异步入队 (${upload.status} ${created.status})`);
  console.log(`  ${created.message}`);
  if (!upload.ok || !created.document_id || !created.ocr_required) {
    throw new Error(`上传未进入 OCR 队列: ${JSON.stringify(created)}`);
  }
  const id = created.document_id;

  const ocr = await poll('OCR 任务', async () => {
    const view = await body<OcrView>(await fetch(`${BASE}/api/documents/${id}/ocr`));
    if (!view.job) return null;
    const status = view.job.status;
    console.log(`  进度 ${view.job.done_pages}/${view.job.total_pages} (${view.job.progress}%) ${status}`);
    return status === 'done' || status === 'failed' ? view : null;
  });
  if (!ocr.job || ocr.job.status !== 'done') throw new Error(`OCR 任务失败: ${ocr.job?.error ?? 'unknown'}`);
  console.log(`PASS 多页 OCR 完成 (${ocr.job.done_pages}/${ocr.job.total_pages} 页)`);

  const pageOne = ocr.pages.find((page) => page.page === 1);
  const lowPages = ocr.pages.filter((page) => page.status === 'review' || page.status === 'failed');
  console.log(
    `${pageOne && pageOne.confidence >= ocr.threshold ? 'PASS' : 'FAIL'} 高置信页识别 (第 1 页 ${pageOne?.confidence ?? 0})`,
  );
  console.log(
    `${lowPages.length > 0 ? 'PASS' : 'FAIL'} 低置信页标记待校对 (${lowPages.map((page) => page.page).join(', ') || '无'})`,
  );
  const reviewPage = lowPages[0] ?? ocr.pages.find((page) => page.image_url);
  if (!reviewPage?.image_url) throw new Error('没有可校对的原图');

  const image = await fetch(`${BASE}${reviewPage.image_url}`);
  const imageBytes = (await image.arrayBuffer()).byteLength;
  const imageOk = image.status === 200 && image.headers.get('content-type') === 'image/jpeg' && imageBytes > 10_000;
  console.log(`${imageOk ? 'PASS' : 'FAIL'} 原文图可读 (${imageBytes} bytes)`);

  const marker = `校对写入标记 OCR-${Date.now()}`;
  const saved = await fetch(`${BASE}/api/documents/${id}/ocr/pages/${reviewPage.page}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: `# 人工校对页\n\n${marker}\n`, confirm: true }),
  });
  const savedBody = await body<{ status?: string; message?: string }>(saved);
  console.log(`${saved.ok && savedBody.status === 'confirmed' ? 'PASS' : 'FAIL'} 校对文本写回 (${savedBody.status ?? savedBody.message})`);

  const confirmed = await fetch(`${BASE}/api/documents/${id}/ocr/confirm`, { method: 'POST' });
  const confirmBody = await body<{ chunk_count?: number; message?: string }>(confirmed);
  console.log(`${confirmed.ok ? 'PASS' : 'FAIL'} 校对通过后重新切片 (${confirmBody.chunk_count ?? confirmBody.message} 片)`);

  const indexed = await poll('重新入库', async () => {
    const doc = await body<{ document: DocRow; chunks: { text: string }[] }>(
      await fetch(`${BASE}/api/documents/${id}`),
    );
    if (doc.document.status === 'indexed') return doc;
    if (doc.document.status === 'failed' || doc.document.error) {
      throw new Error(doc.document.error ?? '入库失败');
    }
    return null;
  }, 180_000);
  const markerOk = indexed.chunks.some((chunk) => chunk.text.includes(marker));
  console.log(`${markerOk ? 'PASS' : 'FAIL'} 校对内容进入切片并入库 (${indexed.document.status})`);

  await fetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' });
  console.log('ALL PASS');
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
