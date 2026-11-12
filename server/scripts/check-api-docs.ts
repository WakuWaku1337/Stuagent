/**
 * B2-4：关键路由清单回归。
 * 只检查文档摘要里承诺存在的关键路径，以及对应路由文件是否仍有注册；不要求覆盖内部测试路由。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/check-api-docs.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');
const readme = read('README.md');

const checks: { name: string; doc: string; file: string; needle: string }[] = [
  { name: '文档批量上传', doc: '/api/documents/batch', file: 'server/src/routes/documents.ts', needle: "documents.post('/batch'" },
  { name: 'OCR 详情', doc: '/api/documents/:id/ocr', file: 'server/src/routes/documents.ts', needle: "documents.get('/:id/ocr'" },
  { name: 'OCR 页图', doc: '/ocr/pages/:page/image', file: 'server/src/routes/documents.ts', needle: "documents.get('/:id/ocr/pages/:page/image'" },
  { name: 'OCR 页校对', doc: 'PUT .../ocr/pages/:page', file: 'server/src/routes/documents.ts', needle: "documents.put('/:id/ocr/pages/:page'" },
  { name: 'OCR 确认', doc: '/ocr/confirm', file: 'server/src/routes/documents.ts', needle: "documents.post('/:id/ocr/confirm'" },
  { name: 'OCR 重试', doc: '/ocr/retry', file: 'server/src/routes/documents.ts', needle: "documents.post('/:id/ocr/retry'" },
  { name: '生成参数设置', doc: '/api/settings/generation', file: 'server/src/routes/settings.ts', needle: "settings.get('/generation'" },
  { name: '密钥列表', doc: '/api/settings/keys', file: 'server/src/routes/settings.ts', needle: "settings.get('/keys'" },
  { name: 'MCP 工具启停', doc: 'tools/:toolName', file: 'server/src/routes/mcp.ts', needle: "mcp.put('/servers/:id/tools/:toolName'" },
  { name: 'MCP 副作用确认', doc: 'tools/:toolName/confirm', file: 'server/src/routes/mcp.ts', needle: "mcp.post('/servers/:id/tools/:toolName/confirm'" },
  { name: '任务取消', doc: '/api/tasks/:id/cancel', file: 'server/src/index.ts', needle: "app.post('/api/tasks/:id/cancel'" },
  { name: '可视化详情', doc: '/api/visualize/:id', file: 'server/src/routes/visualize.ts', needle: "visualize.get('/:id'" },
  { name: '可视化删除', doc: 'DELETE /api/visualize/:id', file: 'server/src/routes/visualize.ts', needle: "visualize.delete('/:id'" },
  { name: 'ASR 能力', doc: '/api/asr', file: 'server/src/routes/voice.ts', needle: "voice.get('/asr'" },
  { name: 'TTS 能力', doc: '/api/tts', file: 'server/src/routes/voice.ts', needle: "voice.get('/tts'" },
  { name: '上线检查', doc: '/api/admin/system-check', file: 'server/src/routes/admin.ts', needle: "admin.get('/system-check'" },
  { name: '消息历史', doc: '/api/conversations/:id/messages', file: 'server/src/routes/conversations.ts', needle: "conversations.get('/:id/messages'" },
];

let failures = 0;
for (const check of checks) {
  const docOk = readme.includes(check.doc);
  const codeOk = read(check.file).includes(check.needle);
  if (!docOk || !codeOk) failures += 1;
  const detail = [!docOk ? 'README 缺失' : '', !codeOk ? `${check.file} 缺失` : ''].filter(Boolean).join('；');
  console.log(`${docOk && codeOk ? 'PASS' : 'FAIL'} ${check.name}${detail ? ` (${detail})` : ''}`);
}

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
