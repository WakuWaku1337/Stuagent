/**
 * B3：文档口径一致性检查。
 * 只检查施工方案点名的关键口径，避免文档再次与代码漂移。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/check-docs.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');

const readme = read('README.md');
const design = read('智学Agent项目设计文档.md');
const progress = read('PROGRESS.md');

const rolesSource = read('server/src/agents/roles.ts');
const docs = { 'README.md': readme, '智学Agent项目设计文档.md': design, 'PROGRESS.md': progress };

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

// 1. DOCLING_OCR_ENGINE 只能描述为透传字段
const ocrLines = Object.entries(docs).flatMap(([file, text]) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.includes('DOCLING_OCR_ENGINE'))
    .map((line) => ({ file, line })),
);
report(ocrLines.length > 0, 'DOCLING_OCR_ENGINE is documented');
const badOcr = ocrLines.filter(
  (item) => !/(透传|ocr_engine)/.test(item.line) || /应用侧.*(auto|docling\+vision)/.test(item.line),
);
report(badOcr.length === 0, 'DOCLING_OCR_ENGINE is described as pass-through only', badOcr.map((i) => i.file).join(', '));

// 2. 未实现功能必须有明确标记
report(design.includes('【未实现，v0.31】'), 'design doc carries explicit unimplemented markers');
report(/多图自动拼接/.test(design) && /多图自动拼接/.test(readme), '复盘多图 is marked unimplemented in design/README');
report(
  /动画播放与题目元素联动高亮【未实现，v0.31】/.test(design) && /可视化动画/.test(readme),
  '可视化动画 is marked unimplemented in design/README',
);
report(/断线重连[^\n]*未实现/.test(design) && /MCP 断线重连/.test(readme), 'MCP 重连 is marked unimplemented in design/README');

// 3. RAG_CANDIDATE_K 默认值 30
for (const [name, text] of [['README.md', readme], ['设计文档', design]] as const) {
  const line = text.split(/\r?\n/).find((item) => item.includes('RAG_CANDIDATE_K'));
  report(Boolean(line?.includes('30')), `${name} documents RAG_CANDIDATE_K=30`, line?.trim().slice(0, 80) ?? 'missing');
}

// 4. 角色工具表与 roles.ts 一致
const labels: Record<string, string> = { tutor: 'Tutor', quizzer: 'Quizzer', analyst: 'Analyst', solver: 'Solver' };
const forbidden: Record<string, string[]> = { analyst: ['mastery_update'] };
for (const [role, label] of Object.entries(labels)) {
  const block = rolesSource.match(new RegExp(`${role}:\\s*\\{[\\s\\S]*?tools:\\s*\\[([^\\]]*)\\]`));
  const tools = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const row = design.split(/\r?\n/).find((line) => line.startsWith(`| ${label}`)) ?? '';
  const missing = tools.filter((tool) => !row.includes(`\`${tool}\``));
  const extra = (forbidden[role] ?? []).filter((tool) => row.includes(`\`${tool}\``));
  report(
    tools.length > 0 && missing.length === 0 && extra.length === 0,
    `6.7.1 ${label} tools match roles.ts`,
    [...missing.map((t) => `缺 ${t}`), ...extra.map((t) => `多 ${t}`)].join('; '),
  );
}

// 5. 历史模型名与掌握度图表口径
const bge = Object.entries(docs).filter(([, text]) => text.includes('BGE-M3')).map(([file]) => file);
report(bge.length === 0, 'no BGE-M3 left in current docs', bge.join(', '));
const masteryEcharts = design
  .split(/\r?\n/)
  .filter((line) => line.includes('掌握度') && line.includes('ECharts') && !/未使用|未实现/.test(line));
report(masteryEcharts.length === 0, 'mastery page is not described as ECharts', masteryEcharts[0]?.trim() ?? '');

// 6. 上传限制口径
report(
  readme.includes('单文件 50MB') && readme.includes('50 个文件') && readme.includes('200MB'),
  'README documents upload limits',
);

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
