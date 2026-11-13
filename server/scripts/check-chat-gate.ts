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
const dataDir = await mkdtemp(join(tmpdir(), 'edupi-gate-'));
const port = 4400 + Math.floor(Math.random() * 300);
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
    AGENT_MAX_CONCURRENT: '2',
    AGENT_MAX_CONCURRENT_PER_USER: '1',
    AGENT_QUEUE_WAIT_MS: '100',
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
const headers = { 'Content-Type': 'application/json', Origin: baseUrl };

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

async function createConversation(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const body = (await response.json()) as { conversation_id?: string };
  if (response.status !== 201 || !body.conversation_id) throw new Error('conversation creation failed');
  return body.conversation_id;
}

try {
  await waitForHealth();
  const conv1 = await createConversation();
  const conv2 = await createConversation();

  const first = fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: '第一问', conversationId: conv1, stream: false }),
  });
  await Promise.race([
    firstRequestStarted,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('mock llm did not receive the first request')), 10_000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const second = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: '第二问', conversationId: conv2, stream: false }),
  });
  const secondBody = (await second.json()) as { code?: string };
  report(
    second.status === 429 && secondBody.code === 'CHAT_BUSY',
    'per-user concurrency limit returns 429',
    `status=${second.status} code=${secondBody.code ?? ''}`,
  );

  const firstResponse = await first;
  report(firstResponse.status === 200, 'first request completes', `status=${firstResponse.status}`);

  const detail = await fetch(`${baseUrl}/api/conversations/${conv2}`);
  const detailBody = (await detail.json()) as { messages?: { role: string }[] };
  const userMessages = (detailBody.messages ?? []).filter((message) => message.role === 'user').length;
  report(userMessages === 0, 'rejected request did not persist a user message', `count=${userMessages}`);

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
}