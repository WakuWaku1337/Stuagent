import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

let releaseFirstRequest: (() => void) | null = null;
const firstRequestStarted = new Promise<void>((resolve) => {
  releaseFirstRequest = resolve;
});
let chatRequests = 0;

const mock = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const url = req.url ?? '';
    if (req.method === 'POST' && url.includes('/chat/completions')) {
      chatRequests += 1;
      releaseFirstRequest?.();
      releaseFirstRequest = null;
      const id = `chatcmpl-${chatRequests}`;
      const base = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'test-model',
      };
      // 故意延迟，保证第二个请求在第一个生成期间到达
      setTimeout(() => {
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
      }, 700);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `unexpected ${req.method} ${url}` } }));
  });
});

await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const address = mock.address();
if (!address || typeof address === 'string') throw new Error('mock listen failed');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = await mkdtemp(join(tmpdir(), 'edupi-lock-'));
const port = 4100 + Math.floor(Math.random() * 300);
const child = spawn(process.execPath, ['--import', 'jiti/register', join(repoRoot, 'server', 'src', 'index.ts')], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EDU_DATA_DIR: dataDir,
    PORT: String(port),
    AUTH_ENABLED: '0',
    NODE_ENV: 'test',
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'test-model',
    LLM_VISION: '0',
    PI_OFFLINE: '1',
    MAINTENANCE_INTERVAL_HOURS: '0',
    AGENT_MAX_CONCURRENT: '10',
    AGENT_MAX_CONCURRENT_PER_USER: '10',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let childLog = '';
child.stdout?.on('data', (chunk) => {
  childLog += chunk;
});
child.stderr?.on('data', (chunk) => {
  childLog += chunk;
});

const baseUrl = `http://127.0.0.1:${port}`;
async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become healthy\n${childLog}`);
}

try {
  await waitForHealth();

  const headers = { 'Content-Type': 'application/json', Origin: baseUrl };
  const created = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const createdText = await created.text();
  let conversation: { conversation_id?: string } = {};
  try {
    conversation = JSON.parse(createdText) as { conversation_id?: string };
  } catch {
    // keep empty
  }
  report(
    created.status === 201 && Boolean(conversation.conversation_id),
    'test conversation created',
    `status=${created.status} body=${createdText.slice(0, 160)}`,
  );
  if (!conversation.conversation_id) throw new Error('conversation creation failed');

  const first = fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: '第一问',
      conversationId: conversation.conversation_id,
      stream: false,
    }),
  });
  await Promise.race([
    firstRequestStarted,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('mock llm did not receive the first request')), 10_000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const second = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: '第二问',
      conversationId: conversation.conversation_id,
      stream: false,
    }),
  });
  const secondBody = (await second.json()) as { code?: string };
  report(
    second.status === 409 && secondBody.code === 'CONVERSATION_BUSY',
    'second concurrent request is rejected',
    `status=${second.status} code=${secondBody.code ?? ''}`,
  );

  const firstResponse = await first;
  report(firstResponse.status === 200, 'first request completes', `status=${firstResponse.status}`);

  const detail = await fetch(`${baseUrl}/api/conversations/${conversation.conversation_id}`);
  const detailBody = (await detail.json()) as { messages?: { role: string }[] };
  const userMessages = (detailBody.messages ?? []).filter((message) => message.role === 'user').length;
  report(userMessages === 1, 'rejected request did not persist a user message', `count=${userMessages}`);

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
}