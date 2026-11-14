import katex from 'katex';

/**
 * Markdown 前置数学保护：避免 marked 把 LaTeX 的 \\ 当作 Markdown 转义。
 * 只在非代码段内保护 $...$、$$...$$、\[...\]、\(...\)。
 */

const CODE_OR_MATH =
  /(```[\s\S]*?```|`[^`\n]*`)|(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$(?:\\.|[^$\n])+?(?<!\\)\$)/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeMath(raw: string): string {
  let math = raw.trim();
  if (math.startsWith('\\[') && math.endsWith('\\]')) {
    math = `$$${math.slice(2, -2)}$$`;
  } else if (math.startsWith('\\(') && math.endsWith('\\)')) {
    math = `$${math.slice(2, -2)}$`;
  }
  return math
    .replace(/\\\\\[\s*\d+(?:\.\d+)?\s*(?:pt|ex|em|mm)\s*\]/g, '\\\\')
    .replace(/\\le(?![a-zA-Z])/g, '\\leq')
    .replace(/\\ge(?![a-zA-Z])/g, '\\geq');
}

export function protectMath(text: string): { text: string; blocks: string[]; tokenPrefix: string } {
  const blocks: string[] = [];
  const tokenPrefix = `@@EDUPI_MATH_${Math.random().toString(36).slice(2, 8)}_`;
  const protectedText = text.replace(CODE_OR_MATH, (match, code: string | undefined, math: string | undefined) => {
    if (code || !math) return match;
    const token = `${tokenPrefix}${blocks.length}@@`;
    blocks.push(normalizeMath(math));
    return token;
  });
  return { text: protectedText, blocks, tokenPrefix };
}

export function restoreMath(html: string, blocks: string[], tokenPrefix: string): string {
  const pattern = new RegExp(`${tokenPrefix}(\\d+)@@`, 'g');
  return html.replace(pattern, (_match, index: string) => escapeHtml(blocks[Number(index)] ?? ''));
}

const renderedMathCache = new Map<string, string>();

/**
 * 将已经识别的数学块直接渲染为 KaTeX HTML。
 * 这样不依赖流式更新后的 DOM 二次 auto-render，避免半截公式或刷新后残留原始 $...$。
 */
function renderMathBlock(block: string): string {
  const source = block.trim();
  const display = source.startsWith('$$') && source.endsWith('$$');
  const body = display
    ? source.slice(2, -2)
    : source.startsWith('$') && source.endsWith('$')
      ? source.slice(1, -1)
      : source;
  const key = `${display ? 'display' : 'inline'}:${body}`;
  const cached = renderedMathCache.get(key);
  if (cached) return cached;
  let html: string;
  try {
    html = katex.renderToString(body, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
    });
  } catch {
    html = escapeHtml(source);
  }
  if (renderedMathCache.size > 1000) renderedMathCache.clear();
  renderedMathCache.set(key, html);
  return html;
}

/**
 * 在已消毒的 Markdown HTML 中注入 KaTeX 结果。
 * 先 sanitize 文本，再注入受信任的 KaTeX 输出，避免 DOMPurify 改写公式节点。
 */
export function renderMathHtml(html: string, blocks: string[], tokenPrefix: string): string {
  const pattern = new RegExp(`${tokenPrefix}(\\d+)@@`, 'g');
  return html.replace(pattern, (_match, index: string) => renderMathBlock(blocks[Number(index)] ?? ''));
}
