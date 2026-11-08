import { readFile, writeFile } from 'node:fs/promises';

const BASE_URL = (process.env.DOCLING_URL ?? 'http://localhost:5001').replace(/\/+$/, '');
const POLL_MS = Math.max(500, Number(process.env.DOCLING_POLL_MS ?? 1500) || 1500);
const CONVERT_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.DOCLING_TIMEOUT_MS ?? 30 * 60_000) || 30 * 60_000,
);
const REQUEST_TIMEOUT_MS = 60_000;
const OCR_ENGINE = process.env.DOCLING_OCR_ENGINE?.trim() || 'auto';
const FORMULA_ENRICHMENT = process.env.DOCLING_FORMULA_ENRICHMENT === '1';
const PAGE_BREAK = '<!--DOCLING_PAGE_BREAK-->';

export interface DoclingPage {
  page: number;
  markdown: string;
  confidence: number | null;
  formulas: number;
}

export interface DoclingConversion {
  pageCount: number;
  markdown: string;
  pages: DoclingPage[];
}

interface DoclingItem {
  self_ref?: string;
  label?: string;
  text?: string;
  level?: number;
  enumerated?: boolean;
  prov?: { page_no?: number }[];
  children?: DoclingRef[];
  captions?: DoclingRef[];
  data?: {
    num_rows?: number;
    num_cols?: number;
    table_cells?: {
      row?: number;
      col?: number;
      text?: string;
      row_span?: number;
      col_span?: number;
      start_row_offset_idx?: number;
      start_col_offset_idx?: number;
    }[];
  };
}

type DoclingRef = { $ref?: string } | null;

interface DoclingDocumentJson {
  pages?: { page_no?: number }[] | Record<string, { page_no?: number }>;
  body?: { children?: DoclingRef[] };
  groups?: DoclingItem[];
  texts?: DoclingItem[];
  tables?: DoclingItem[];
  pictures?: DoclingItem[];
}

export function doclingBaseUrl(): string {
  return BASE_URL;
}

export async function doclingAvailable(): Promise<boolean> {
  for (const path of ['/health', '/v1/health']) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // 尝试下一个健康检查路径
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(res: Response, path: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!res.ok) throw new Error(`Docling ${path} 返回 ${res.status}：${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Docling ${path} 返回非 JSON：${text.slice(0, 300)}`);
  }
}

function taskIdOf(body: Record<string, unknown>): string {
  const value = body.task_id ?? body.taskId ?? body.id;
  if (typeof value !== 'string' || !value) throw new Error('Docling 未返回 task_id');
  return value;
}

function taskStatusOf(body: Record<string, unknown>): string {
  const value = body.task_status ?? body.status;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

async function submit(file: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(file)], { type: 'application/pdf' }), filename);
  form.append('to_formats', 'md');
  form.append('to_formats', 'json');
  form.append('do_ocr', 'true');
  form.append('ocr_engine', OCR_ENGINE);
  if (FORMULA_ENRICHMENT) form.append('do_formula_enrichment', 'true');
  form.append('md_page_break_placeholder', PAGE_BREAK);
  const res = await fetch(`${BASE_URL}/v1/convert/file/async`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return taskIdOf(await readJson(res, '/v1/convert/file/async'));
}

async function waitForTask(taskId: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < CONVERT_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/v1/status/poll/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await readJson(res, `/v1/status/poll/${taskId}`);
      const status = taskStatusOf(body);
      if (status === 'success' || status === 'partial_success') {
        const result = await fetch(`${BASE_URL}/v1/result/${encodeURIComponent(taskId)}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return await readJson(result, `/v1/result/${taskId}`);
      }
      if (status === 'failure' || status === 'revoked' || status === 'cancelled' || status === 'skipped') {
        const detail = body.error_message ?? body.failure ?? body.error ?? body.message ?? status;
        throw new Error(`Docling 转换失败：${String(detail).slice(0, 300)}`);
      }
      last = status || last;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Docling 转换失败')) throw error;
      if (Date.now() - started > 15_000) {
        throw new Error(
          `Docling 服务不可用（${BASE_URL}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Docling 转换超时（${Math.round(CONVERT_TIMEOUT_MS / 1000)}s，最后状态 ${last || 'unknown'}）`);
}

function unwrapResult(body: Record<string, unknown>): {
  document: Record<string, unknown>;
  confidence: unknown;
} {
  const nested = (body.result ?? body.outputs) as Record<string, unknown> | undefined;
  const document = (body.document ?? nested?.document ?? body.outputs ?? nested ?? body) as Record<string, unknown>;
  const confidence = body.confidence ?? nested?.confidence ?? document.confidence;
  return { document, confidence };
}

function parseJsonContent(value: unknown): DoclingDocumentJson | null {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    return parsed && typeof parsed === 'object' ? (parsed as DoclingDocumentJson) : null;
  } catch {
    return null;
  }
}

function resolveRef(doc: DoclingDocumentJson, ref: DoclingRef): DoclingItem | null {
  const path = ref?.$ref;
  if (!path) return null;
  const match = /^#\/(texts|groups|tables|pictures)\/(\d+)$/.exec(path);
  if (!match) return null;
  const list = doc[match[1] as 'texts' | 'groups' | 'tables' | 'pictures'];
  return list?.[Number(match[2])] ?? null;
}

function pageOf(item: DoclingItem, fallback: number): number {
  const page = item.prov?.find((entry) => Number.isFinite(entry.page_no))?.page_no;
  return page && page > 0 ? page : fallback;
}

function formulaCount(markdown: string): number {
  return (markdown.match(/<!--\s*formula-not-decoded\s*-->/g) ?? []).length;
}

function cleanDoclingMarkdown(markdown: string): string {
  return markdown
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<!--\s*image\s*-->/gi, '[图]')
    .replace(/<!--\s*formula-not-decoded\s*-->/gi, '[公式]')
    .trim();
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
}

function tableToMarkdown(item: DoclingItem): string {
  const cells = item.data?.table_cells ?? [];
  const rows = item.data?.num_rows ?? 0;
  const cols = item.data?.num_cols ?? 0;
  if (rows <= 0 || cols <= 0 || cells.length === 0) return '';
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
  for (const cell of cells) {
    const row = cell.start_row_offset_idx ?? cell.row ?? 0;
    const col = cell.start_col_offset_idx ?? cell.col ?? 0;
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    grid[row][col] = escapeCell(cell.text ?? '');
  }
  const header = `| ${grid[0].join(' | ')} |`;
  const divider = `| ${grid[0].map(() => '---').join(' | ')} |`;
  const body = grid.slice(1).map((line) => `| ${line.join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function textToMarkdown(item: DoclingItem): string {
  const text = item.text?.trim();
  if (!text) return '';
  switch (item.label) {
    case 'title':
      return `# ${text}`;
    case 'section_header':
      return `${'#'.repeat(Math.min(6, Math.max(2, item.level ?? 2)))} ${text}`;
    case 'list_item':
      return `${item.enumerated ? '1.' : '-'} ${text}`;
    case 'formula':
      return `$$${text}$$`;
    case 'code':
      return `\`\`\`\n${text}\n\`\`\``;
    default:
      return text;
  }
}

const SKIP_LABELS = new Set(['page_header', 'page_footer']);

function collectPageItems(
  doc: DoclingDocumentJson,
  refs: DoclingRef[] | undefined,
  currentPage: number,
  out: Map<number, string[]>,
  seen: Set<string>,
): number {
  let page = currentPage;
  for (const ref of refs ?? []) {
    if (!ref?.$ref || seen.has(ref.$ref)) continue;
    seen.add(ref.$ref);
    const item = resolveRef(doc, ref);
    if (!item) continue;
    page = pageOf(item, page);

    if (item.label && SKIP_LABELS.has(item.label)) continue;
    if (item.data?.table_cells) {
      const table = tableToMarkdown(item);
      if (table) {
        const lines = out.get(page) ?? [];
        lines.push(table);
        out.set(page, lines);
      }
      continue;
    }
    if (item.label === 'picture') {
      const lines = out.get(page) ?? [];
      lines.push('[图]');
      out.set(page, lines);
      collectPageItems(doc, item.captions, page, out, seen);
      continue;
    }
    if (item.text !== undefined) {
      const markdown = textToMarkdown(item);
      if (markdown) {
        const lines = out.get(page) ?? [];
        lines.push(markdown);
        out.set(page, lines);
      }
      collectPageItems(doc, item.children, page, out, seen);
      continue;
    }
    collectPageItems(doc, item.children, page, out, seen);
  }
  return page;
}

function gradeScore(grade: unknown): number | null {
  switch (String(grade ?? '').toLowerCase()) {
    case 'excellent':
    case '高':
      return 0.95;
    case 'good':
    case '良好':
      return 0.85;
    case 'fair':
    case '一般':
      return 0.65;
    case 'poor':
    case '差':
      return 0.4;
    default:
      return null;
  }
}

interface ConfidenceEntry {
  page_no?: number;
  page?: number;
  layout_score?: number;
  ocr_score?: number;
  parse_score?: number;
  table_score?: number;
  grade?: string;
}

function confidenceForPage(report: unknown, page: number): number | null {
  if (!report) return null;
  const root = report as {
    pages?: ConfidenceEntry[] | Record<string, ConfidenceEntry>;
    page_confidences?: ConfidenceEntry[];
  } & ConfidenceEntry;
  let entries: ConfidenceEntry[];
  if (Array.isArray(report)) {
    entries = report as ConfidenceEntry[];
  } else if (root.pages && !Array.isArray(root.pages)) {
    const entry = root.pages[String(page)] ?? root.pages[page];
    entries = entry ? [entry] : [];
  } else {
    entries = (root.pages as ConfidenceEntry[] | undefined) ?? root.page_confidences ?? [];
  }
  const entry = entries.find((item) => (item.page_no ?? item.page ?? page) === page);
  if (!entry) return null;
  // 校对关注“文字识别准不准”，layout 分低只代表版面复杂，不应把整页标成待校对
  if (typeof entry.ocr_score === 'number' && Number.isFinite(entry.ocr_score)) {
    return Math.round(entry.ocr_score * 100) / 100;
  }
  const scores = [entry.layout_score, entry.parse_score, entry.table_score].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (scores.length > 0) return Math.round(Math.min(...scores) * 100) / 100;
  return gradeScore(entry.grade);
}

/**
 * 把 Docling 的整篇 JSON 还原成逐页 Markdown。
 * 优先按 body 阅读顺序取条目及其 prov.page_no；缺失页码时沿用上一页。
 */
export function pagesFromDocling(json: DoclingDocumentJson, report: unknown): DoclingPage[] {
  const out = new Map<number, string[]>();
  const seen = new Set<string>();
  collectPageItems(json, json.body?.children, 1, out, seen);
  if (out.size === 0) {
    for (const item of [...(json.texts ?? []), ...(json.tables ?? []), ...(json.pictures ?? [])]) {
      const page = pageOf(item, 1);
      const markdown = item.data?.table_cells
        ? tableToMarkdown(item)
        : item.label === 'picture'
          ? '[图]'
          : textToMarkdown(item);
      if (markdown) {
        const lines = out.get(page) ?? [];
        lines.push(markdown);
        out.set(page, lines);
      }
    }
  }
  const declared = Array.isArray(json.pages)
    ? json.pages.map((page) => page.page_no ?? 0)
    : Object.entries(json.pages ?? {}).map(([key, page]) => page.page_no ?? Number(key) ?? 0);
  const detected = [...out.keys()];
  const pageCount = Math.max(0, ...declared.filter((page) => page > 0), ...detected);
  const pages: DoclingPage[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const raw = (out.get(page) ?? []).join('\n\n');
    pages.push({
      page,
      markdown: cleanDoclingMarkdown(raw),
      confidence: confidenceForPage(report, page),
      formulas: formulaCount(raw),
    });
  }
  return pages;
}

function parseConversion(body: Record<string, unknown>): DoclingConversion {
  const { document, confidence } = unwrapResult(body);
  const json = parseJsonContent(document.json_content ?? document.json ?? document.document ?? document);
  if (!json) throw new Error('Docling 未返回可解析的 JSON 文档');
  const rawMarkdown = String(document.md_content ?? document.md ?? '');
  const markdown = cleanDoclingMarkdown(rawMarkdown);
  const pages = pagesFromDocling(json, confidence);
  if (pages.length === 0) throw new Error('Docling 结果没有页面');

  // 先按占位符切分再清理，否则公式占位符会被提前替换，公式计数永远为 0
  const split = rawMarkdown.includes(PAGE_BREAK)
    ? rawMarkdown.split(PAGE_BREAK).map((part) => part.trim())
    : [];
  if (split.length === pages.length) {
    return {
      pageCount: pages.length,
      markdown,
      pages: split.map((part, index) => ({
        page: index + 1,
        markdown: cleanDoclingMarkdown(part),
        confidence: confidenceForPage(confidence, index + 1),
        formulas: formulaCount(part),
      })),
    };
  }
  return { pageCount: pages.length, markdown, pages };
}

export async function convertWithDocling(
  file: string | Buffer,
  filename: string,
  options: { cacheFile?: string; force?: boolean } = {},
): Promise<DoclingConversion> {
  if (options.cacheFile && !options.force) {
    try {
      const cached = JSON.parse(await readFile(options.cacheFile, 'utf8')) as Record<string, unknown>;
      return parseConversion(cached);
    } catch {
      // 缓存缺失或损坏时重新转换
    }
  }
  const buffer = typeof file === 'string' ? await readFile(file) : file;
  const taskId = await submit(buffer, filename);
  const result = await waitForTask(taskId);
  const conversion = parseConversion(result);
  if (options.cacheFile) {
    try {
      await writeFile(options.cacheFile, JSON.stringify(result));
    } catch {
      // 缓存写入失败不影响本次转换
    }
  }
  return conversion;
}

