import type { VisualizationType } from '../../visualize.ts';
import { parseExpression } from '../../../../../shared/expression.ts';

export interface ModeledVisualization {
  type: VisualizationType;
  title: string;
  spec: Record<string, unknown>;
  basis: string;
}

function clampText(text: string, max = 80): string {
  return text.trim().slice(0, max);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(input: string): string {
  return input
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，、]/g, ',')
    .replace(/[。；]/g, ';')
    .replace(/[：]/g, ':')
    .replace(/[－—–−]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[×·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/[≠]/g, '!=')
    .replace(/[π]/g, 'pi')
    .replace(/[√]/g, 'sqrt')
    .replace(/[₀]/g, '0')
    .replace(/[₁]/g, '1')
    .replace(/[₂]/g, '2')
    .replace(/[₃]/g, '3')
    .replace(/[₄]/g, '4')
    .replace(/[²]/g, '^2')
    .replace(/[³]/g, '^3')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExpression(raw: string): string {
  let text = normalizeText(raw)
    .replace(/\\left|\\right/g, '')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\pi/g, 'pi')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\le(?![a-zA-Z])/g, '<=')
    .replace(/\\ge(?![a-zA-Z])/g, '>=')
    .replace(/[{}]/g, '')
    // 只去掉函数名与括号之间的空白，不插入乘号
    .replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '$1(')
    // 数字后接字母/括号，补乘号：2x、2(x+1)
    .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')
    // 右括号后接字母/数字/左括号，补乘号：g(x)g(、)(、)2
    .replace(/\)\s*([a-zA-Z0-9(])/g, ')*$1')
    .replace(/[^a-zA-Z0-9+\-*/^().,<>=!|]/g, '')
    .replace(/\s+/g, '');
  text = text.replace(/^=+/, '').replace(/=+$/, '');
  return text;
}

function hasVariable(expression: string): boolean {
  return /[xy]/.test(expression);
}

function splitExpression(raw: string): string {
  const cleaned = normalizeText(raw)
    .split(/,|;|和|与|及|的图像|的图象|的顶点|的零点|的对称轴|在区间|求|画|作出|判断/)[0]
    .trim();
  return normalizeExpression(cleaned);
}

function extractInterval(question: string): [number, number] | null {
  const match = normalizeText(question).match(/\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  return [min, max];
}

function autoRange(expression: string): [number, number] {
  if (/sin|cos|tan/.test(expression)) return [-6.283, 6.283];
  if (/abs/.test(expression)) return [-8, 8];
  if (/sqrt|log|ln/.test(expression)) return [0, 12];
  const quadratic = expression.match(/^(-?\d*\.?\d*)\*?x\^2([+-]\d*\.?\d*)?\*?x?([+-]\d*\.?\d*)?$/);
  if (quadratic) {
    const a = quadratic[1] === '' || quadratic[1] === '+' ? 1 : quadratic[1] === '-' ? -1 : Number(quadratic[1]);
    const b = quadratic[2] === undefined ? 0 : Number(quadratic[2]);
    const c = quadratic[3] === undefined ? 0 : Number(quadratic[3]);
    if (Number.isFinite(a) && a !== 0) {
      const vertex = -b / (2 * a);
      const discriminant = b * b - 4 * a * c;
      const roots = discriminant >= 0 ? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)] : [];
      const values = [vertex, ...roots];
      return [Math.floor(Math.min(...values) - 3), Math.ceil(Math.max(...values) + 3)];
    }
  }
  return [-10, 10];
}

function cutFunctionBody(raw: string): string {
  const text = raw.trim();
  const casesStart = text.indexOf('\\begin{cases}');
  if (casesStart >= 0) {
    const casesEnd = text.indexOf('\\end{cases}', casesStart);
    if (casesEnd >= 0) return text.slice(0, casesEnd + '\\end{cases}'.length).trim();
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === ',' || char === ';')) return text.slice(0, index).trim();
    else if (depth === 0 && /^的(图像|图象|顶点|零点|对称轴|交点)/.test(text.slice(index))) {
      return text.slice(0, index).trim();
    }
    else if (depth === 0 && /^[与和及]/.test(text.slice(index))) {
      return text.slice(0, index).trim();
    }
  }
  return text;
}

function normalizeCondition(raw: string): string {
  const text = normalizeText(raw)
    .replace(/\\le(?![a-zA-Z])/g, '<=')
    .replace(/\\ge(?![a-zA-Z])/g, '>=')
    .replace(/\\lt(?![a-zA-Z])/g, '<')
    .replace(/\\gt(?![a-zA-Z])/g, '>')
    .replace(/\s+/g, '');
  const chain = text.match(/^(.+?)(<=|<|>=|>)(.+?)(<=|<|>=|>)(.+)$/);
  if (chain) {
    const [, left, op1, middle, op2, right] = chain;
    return `${left}${op1}${middle}&&${middle}${op2}${right}`;
  }
  return text;
}

function parseCases(raw: string): { when: string; then: string }[] {
  const start = raw.indexOf('\\begin{cases}');
  const end = raw.indexOf('\\end{cases}');
  if (start < 0 || end < 0 || end <= start) throw new Error('分段函数缺少 \\begin{cases} 或 \\end{cases}');
  let body = raw.slice(start + '\\begin{cases}'.length, end);
  body = body.replace(/\\\\\[\s*\d+(?:\.\d+)?\s*(?:pt|ex|em|mm)\s*\]/g, '\\\\');
  const rows = body.split(/\\\\/).map((row) => row.trim()).filter(Boolean);
  if (rows.length === 0) throw new Error('分段函数没有分支');
  return rows.map((row) => {
    const cleaned = row.replace(/^\[\s*\d+(?:\.\d+)?\s*(?:pt|ex|em|mm)\s*\]/, '').trim();
    const separator = cleaned.search(/[,&]/);
    if (separator < 0) throw new Error('分段函数每行必须是“表达式, 条件”');
    const thenRaw = cleaned.slice(0, separator).trim();
    const whenRaw = cleaned.slice(separator + 1).trim().replace(/^&\s*/, '');
    const then = normalizeExpression(thenRaw);
    const when = normalizeCondition(whenRaw);
    if (!then || !when) throw new Error('分段函数分支为空');
    parseExpression(then);
    parseExpression(when);
    return { when, then };
  });
}

export {
  autoRange,
  clampText,
  cutFunctionBody,
  extractInterval,
  hasVariable,
  normalizeCondition,
  normalizeExpression,
  normalizeText,
  parseCases,
  round,
  splitExpression,
};
