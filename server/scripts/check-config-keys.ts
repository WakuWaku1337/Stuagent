/**
 * C11 回归：配置项一致性（server/src + server/scripts 全部读取点 + web 构建变量 ↔ README 配置节）。
 * 防止新增开关只写进代码或只写进文档，造成配置漂移。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/check-config-keys.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');

const KEY = /`([A-Z][A-Z0-9_]{2,})`/g;
const collect = (text: string): Set<string> => new Set([...text.matchAll(KEY)].map((m) => m[1]));

// README 配置节是唯一登记源；旧施工文档已删除，不再作为门禁依赖。
// 只取表格第一列，避免把说明列里引用的错误码（如 MCP_CONFIRMATION_REQUIRED）误判为配置键。
const readmeSource = read('README.md');
const readmeSection = readmeSource.split('## 配置')[1]?.split('## 数据与检索')[0] ?? '';
const docKeys = new Set<string>();
for (const line of readmeSection.split('\n')) {
  if (!line.startsWith('|')) continue;
  const firstCell = line.split('|')[1] ?? '';
  for (const match of firstCell.matchAll(KEY)) docKeys.add(match[1]);
}
const readmeKeys = new Set(docKeys);

function walk(dir: string, pattern: RegExp, output: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pattern, output);
    else if (pattern.test(entry.name)) output.push(full);
  }
  return output;
}

const ENV_RE = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g;
const HELPER_RE = /(?:envNumber|envFlag|envText|boundedInt)\(\s*'([A-Z][A-Z0-9_]+)'/g;

const codeKeys = new Set<string>();
for (const file of walk(resolve(root, 'server/src'), /\.ts$/)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(ENV_RE)) codeKeys.add(match[1] ?? match[2]);
  for (const match of text.matchAll(HELPER_RE)) codeKeys.add(match[1]);
}
for (const file of walk(resolve(root, 'web/src'), /\.(ts|vue)$/)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]+)/g)) codeKeys.add(match[1]);
}

/** 系统/运行时注入键：不是产品配置，不要求登记。 */
const EXEMPT = new Set(['NODE_ENV', 'PORT', 'PATH', 'HOME', 'TEMP', 'TMP', 'PI_OFFLINE']);

// SSE_RETRY_MAX 是文档中服务端侧名称，代码实现为前端构建变量。
const alias: Record<string, string> = { SSE_RETRY_MAX: 'VITE_SSE_RETRY_MAX' };
const resolveKey = (key: string): string => alias[key] ?? key;

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

report(docKeys.size >= 20, 'README config section parsed', `${docKeys.size} keys`);
const missingInReadme = [...docKeys].filter((key) => !readmeKeys.has(key));
report(missingInReadme.length === 0, 'every documented key appears in README', missingInReadme.join(', '));
const missingInCode = [...docKeys].filter((key) => !codeKeys.has(resolveKey(key)));
report(missingInCode.length === 0, 'every documented key is read by code', missingInCode.join(', '));
const unregistered = [...codeKeys].filter((key) => !docKeys.has(key) && !readmeKeys.has(key) && !EXEMPT.has(key));
report(unregistered.length === 0, 'no unregistered switch in source', unregistered.join(', '));

const exempted = [...codeKeys].filter((key) => EXEMPT.has(key)).sort();
console.log(`---\n已登记键 ${docKeys.size}：${[...docKeys].sort().join(', ')}`);
console.log(`代码键 ${codeKeys.size}：${[...codeKeys].sort().join(', ')}`);
console.log(`豁免键 ${exempted.length}：${exempted.join(", ") || "(none)"}`);
console.log(`未登记键 ${unregistered.length}：${unregistered.join(", ") || "(none)"}`);

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;