import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const seenKeys: string[] = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const url = req.url ?? '';
    if (req.method === 'POST' && url.includes('/chat/completions')) {
      const auth = String(req.headers.authorization ?? '');
      seenKeys.push(auth.replace(/^Bearer\s+/i, '') || 'none');
      const id = `chatcmpl-${seenKeys.length}`;
      const base = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'test-model',
      };
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: { role: 'assistant', content: '这是完整回答。' }, finish_reason: null }],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (req.method === 'GET' && url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `unexpected ${req.method} ${url} ${body.slice(0, 80)}` } }));
  });
});

await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const address = mock.address();
if (!address || typeof address === 'string') throw new Error('mock listen failed');

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-pinning-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
process.env.LLM_API_KEY = 'env-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_VISION = '0';
process.env.EDUPI_SETTINGS_SECRET = 'pinning-test-secret';
process.env.PI_OFFLINE = '1';
process.env.AGENT_MAX_CONCURRENT = '10';
process.env.AGENT_MAX_CONCURRENT_PER_USER = '10';
process.env.AGENT_QUEUE_WAIT_MS = '1000';

const { db } = await import('../src/store.ts');
const { saveApiKey } = await import('../src/settings/store.ts');
const { chat, resetPiRuntime } = await import('../src/pi.ts');

try {
  const keyA = saveApiKey('env', '测试 A', 'key-a');
  const keyB = saveApiKey('env', '测试 B', 'key-b');
  report(Boolean(keyA.key_id && keyB.key_id), 'two extra provider keys saved');

  resetPiRuntime();
  const events: string[] = [];
  const first = await chat('conv-pinning', '第一问', (event) => events.push(event.type), undefined, 'tutor', {
    history: [],
  });
  const second = await chat('conv-pinning', '第二问', (event) => events.push(event.type), undefined, 'tutor', {
    history: [],
  });
  const third = await chat('conv-pinning', '第三问', (event) => events.push(event.type), undefined, 'tutor', {
    history: [],
  });

  report(first.length > 0 && second.length > 0 && third.length > 0, 'three turns completed');
  report(seenKeys.length === 3, 'mock llm received three requests', `count=${seenKeys.length}`);
  report(seenKeys[0] === seenKeys[1] && seenKeys[1] === seenKeys[2], 'same conversation pins the same key', seenKeys.join(','));
  report(events.includes('done'), 'chat emits done event');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  resetPiRuntime();
  db.close();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
}