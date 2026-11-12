import type { ParsedBlock } from './parsers.ts';
import { documentPiiRedactEnabled } from '../config.ts';
import { redactPII } from '../security/guard.ts';

export interface ChunkDraft {
  text: string;
  chapter: string;
  page?: number;
}

const TARGET_MAX = 800;
const MIN_CHUNK = 500;
const OVERLAP = 80;

/** 语义优先：段落累计到 500-800 字一片，相邻片重叠 80 字；超长段落用窗口切分 */
export function chunkBlocks(blocks: ParsedBlock[]): ChunkDraft[] {
  // 开启脱敏后切片只保留脱敏文本，引用无法回查原文（默认关闭）
  const source = documentPiiRedactEnabled()
    ? blocks.map((block) => ({ ...block, text: redactPII(block.text).text }))
    : blocks;
  const chunks: ChunkDraft[] = [];
  let buffer = '';
  let chapter = '';
  let page: number | undefined;

  const flush = () => {
    const text = buffer.trim();
    if (text) chunks.push({ text, chapter, page });
    buffer = '';
  };

  for (const block of source) {
    const paragraphs = block.text
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const para of paragraphs) {
      if (para.length > TARGET_MAX) {
        flush();
        for (const piece of windowSplit(para)) {
          chunks.push({ text: piece, chapter: block.chapter, page: block.page });
        }
        continue;
      }

      if (buffer && (buffer.length + para.length + 1 > TARGET_MAX || block.chapter !== chapter || block.page !== page)) {
        flush();
      }

      if (buffer && buffer.length < MIN_CHUNK) {
        buffer += `\n${para}`;
      } else if (!buffer) {
        buffer = para;
      } else {
        flush();
        buffer = para;
      }
      chapter = block.chapter;
      page = block.page;
    }
  }
  flush();

  if (chunks.length === 0) return chunks;
  return applyOverlap(chunks);
}

function windowSplit(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + TARGET_MAX - OVERLAP);
    let cut = end;
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf('。', end),
        text.lastIndexOf('；', end),
        text.lastIndexOf('\n', end),
      );
      if (boundary > start + MIN_CHUNK / 2) cut = boundary + 1;
    }
    out.push(text.slice(start, cut).trim());
    if (cut >= text.length) break;
    start = Math.max(start + 1, cut - OVERLAP);
  }
  return out.filter(Boolean);
}

function applyOverlap(chunks: ChunkDraft[]): ChunkDraft[] {
  return chunks.map((c, i) => {
    if (i === 0) return c;
    const prev = chunks[i - 1];
    if (prev.chapter !== c.chapter || prev.page !== c.page) return c;
    const tail = prev.text.slice(-OVERLAP).replace(/^[^。；\n]*?[。；\n]/, '').trim();
    if (!tail || c.text.includes(tail)) return c;
    return { ...c, text: `${tail}\n${c.text}` };
  });
}