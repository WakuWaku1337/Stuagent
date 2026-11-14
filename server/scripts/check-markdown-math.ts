/**
 * B5 回归：Markdown 数学保护层。
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/check-markdown-math.ts
 */
import { marked } from 'marked';
import { protectMath, restoreMath, renderMathHtml, normalizeMath } from '../../web/src/utils/math.ts';

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const piecewise = '$$g(x)=\\begin{cases}6, & x\\le -3\\\\[2pt]-2x, & -3<x<3\\\\[2pt]-6, & x\\ge 3\\end{cases}$$';
const prepared = protectMath(piecewise);
const html = restoreMath(marked.parse(prepared.text, { async: false }) as string, prepared.blocks, prepared.tokenPrefix);
report(prepared.blocks.length === 1, 'protect one display math block');
report(html.includes('\\\\'), 'restored html keeps double-backslash line breaks');
const rendered = renderMathHtml(marked.parse(prepared.text, { async: false }) as string, prepared.blocks, prepared.tokenPrefix);
report(rendered.includes('class="katex"') && !rendered.includes('$'), 'renders display math directly to KaTeX HTML');
report(!html.includes('[2pt]'), 'spacing markers are removed');
report(html.includes('\\leq') && html.includes('\\geq'), 'le/ge normalized to leq/geq');

const displayPrepared = protectMath('\\[x^2\\]');
const escaped = restoreMath(
  marked.parse(displayPrepared.text, { async: false }) as string,
  displayPrepared.blocks,
  displayPrepared.tokenPrefix,
);
report(escaped.includes('$$x^2$$'), 'display delimiters normalized to $$');

const inline = protectMath('行内 $\\frac{1}{2}$ 结束');
report(inline.blocks.length === 1 && inline.blocks[0].includes('\\frac'), 'protect inline math');

const code = protectMath('```\n$x$ and \\\\[2pt]\n```');
report(code.blocks.length === 0, 'do not protect math inside fenced code');

report(normalizeMath('\\[x^2\\]') === '$$x^2$$', 'normalizeMath converts \\[...\\]');
report(normalizeMath('x\\\\[6pt]y') === 'x\\\\y', 'normalizeMath strips optional row spacing');

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
