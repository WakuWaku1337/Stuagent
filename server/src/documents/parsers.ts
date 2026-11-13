export interface ParsedBlock {
  text: string;
  chapter: string;
  page?: number;
}

import iconv from 'iconv-lite';

const HEADING_RE = /^(#{1,4})\s+(.+)$/;

/** Markdown：按标题维护章节路径，正文按空行分段 */
export function parseMarkdown(raw: string): ParsedBlock[] {
  const lines = raw.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  const stack: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ text, chapter: stack.join(' > ') });
    buffer = [];
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line.trim());
    if (m) {
      flush();
      const level = m[1].length;
      stack.length = Math.max(0, level - 1);
      stack[level - 1] = m[2].trim();
      stack.length = level;
      continue;
    }
    buffer.push(line);
    if (line.trim() === '') flush();
  }
  flush();
  return mergeTinyBlocks(blocks);
}

/** 纯文本：按空行分段，章节留空 */
export function parseText(raw: string): ParsedBlock[] {
  return mergeTinyBlocks(
    raw
      .split(/\r?\n\s*\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text, chapter: '' })),
  );
}

/** DOCX：转 HTML 后把标题层级还原成章节路径 */
export async function parseDocx(buffer: Buffer): Promise<ParsedBlock[]> {
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const blocks: ParsedBlock[] = [];
  const stack: string[] = [];
  const re = /<(h[1-4]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const text = htmlToText(m[2]);
    if (!text) continue;
    if (/^h[1-4]$/.test(tag)) {
      const level = Number(tag[1]);
      stack.length = Math.max(0, level - 1);
      stack[level - 1] = text;
      stack.length = level;
      continue;
    }
    blocks.push({ text, chapter: stack.join(' > ') });
  }
  return mergeTinyBlocks(blocks);
}

/** DOC（老二进制格式） */
export async function parseDoc(buffer: Buffer): Promise<ParsedBlock[]> {
  const WordExtractor = (await import('word-extractor')).default;
  const doc = await new WordExtractor().extract(buffer);
  return parseText(doc.getBody());
}

/** PDF：逐页提取文本，保留页码 */
export async function parsePdf(buffer: Buffer): Promise<ParsedBlock[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const params = {
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  };
  const loadingTask = pdfjs.getDocument(params as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;
  const blocks: ParsedBlock[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) lines.push('\n');
      lines.push(item.str);
      lastY = y;
    }
    const text = lines.join('').replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const chapter = detectChapter(text);
    for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
      blocks.push({ text: para, chapter, page: i });
    }
  }
  await loadingTask.destroy();
  return mergeTinyBlocks(blocks);
}

function detectChapter(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return firstLine.length <= 30 ? firstLine : '';
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 相邻极短段落合并，减少碎片 chunk */
function mergeTinyBlocks(blocks: ParsedBlock[], minLen = 80): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (prev && prev.chapter === block.chapter && prev.page === block.page && prev.text.length < minLen) {
      prev.text += `\n${block.text}`;
    } else {
      out.push({ ...block });
    }
  }
  return out;
}

export function detectEncoding(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return iconv.decode(buffer, 'gbk');
}