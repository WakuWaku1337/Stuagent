export const MAX_CONTINUATIONS = 3;

const CONTINUATION_TAIL = 1200;

/** 结构完整性判断：代码围栏、括号、明显未完成的结尾标点。 */
export function looksIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const fences = (trimmed.match(/```/g) ?? []).length;
  if (fences % 2 === 1) return true;

  const visible = trimmed.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const displayMath = (visible.match(/(?<!\\)\$\$/g) ?? []).length;
  if (displayMath % 2 === 1) return true;
  const inlineMath = (visible.replace(/(?<!\\)\$\$/g, '').match(/(?<!\\)\$/g) ?? []).length;
  if (inlineMath % 2 === 1) return true;
  const casesOpen = (visible.match(/\\begin\{cases\}/g) ?? []).length;
  const casesClose = (visible.match(/\\end\{cases\}/g) ?? []).length;
  if (casesOpen !== casesClose) return true;

  const pairs: [string, string][] = [
    ['(', ')'],
    ['（', '）'],
    ['[', ']'],
    ['【', '】'],
    ['{', '}'],
  ];
  for (const [open, close] of pairs) {
    const opens = trimmed.split(open).length - 1;
    const closes = trimmed.split(close).length - 1;
    if (opens > closes) return true;
  }

  return /[，、,:：；;（(【\[《<—\-]$/.test(trimmed);
}

/** 拼接续写片段：优先消掉模型重复输出的重叠前缀。 */
export function mergeContinuation(existing: string, addition: string): string {
  const next = addition.replace(/^\s+/, '');
  if (!next) return existing;
  if (!existing) return next;

  const max = Math.min(existing.length, next.length, CONTINUATION_TAIL);
  for (let length = max; length >= 16; length -= 1) {
    if (existing.slice(-length) === next.slice(0, length)) {
      return existing + next.slice(length);
    }
  }
  const existingDollars = (existing.replace(/(?<!\\)\$\$/g, '').match(/(?<!\\)\$/g) ?? []).length;
  const mathBoundary = existing.endsWith('$') || next.startsWith('$') || existing.endsWith('\\') || existingDollars % 2 === 1;
  const needBreak = !existing.endsWith('\n') && !/^\s/.test(addition) && !mathBoundary;
  return existing + (needBreak ? '\n' : '') + next;
}

function tailOf(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > CONTINUATION_TAIL ? trimmed.slice(-CONTINUATION_TAIL) : trimmed;
}

/**
 * 构造自动续写提示，只附带末尾上下文以控制 token 消耗。
 * @param text 已写内容。
 * @param attempt 当前续写轮次。
 * @returns 续写提示文本。
 */
export function continuationPrompt(text: string, attempt: number): string {
  return [
    `（系统续写 ${attempt}/${MAX_CONTINUATIONS}）上一条回答被截断。`,
    '请从断点继续，不要重复已经写过的内容，不要重新开头。',
    '保持原有 Markdown/LaTeX 格式；如果断点在公式中，先补全公式，不要省略 $...$。',
    '',
    '已写内容末尾：',
    tailOf(text),
    '',
    '直接从断点继续。',
  ].join('\n');
}

/**
 * 构造用户主动点击“继续生成”时使用的续写提示。
 * @param text 已写内容。
 * @returns 续写提示文本。
 */
export function manualContinuationPrompt(text: string): string {
  return [
    '（手动续写）上一条回答被截断，请从断点继续，不要重复已经写过的内容，不要重新开头。',
    '保持原有 Markdown/LaTeX 格式；如果断点在公式中，先补全公式，不要省略 $...$。',
    '',
    '已写内容末尾：',
    tailOf(text),
    '',
    '直接从断点继续。',
  ].join('\n');
}
