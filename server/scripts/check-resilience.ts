import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-resilience-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.RAG_TIMEOUT_MS = '1000';
process.env.RAG_RETRY_MAX = '1';
process.env.MILVUS_TIMEOUT_MS = '500';
process.env.MILVUS_ADDRESS = '127.0.0.1:1';
process.env.TASK_RETRY_MAX = '1';
process.env.AGENT_WALL_CLOCK_MS = '1000';
process.env.AGENT_MAX_TOOL_STEPS = '2';

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const { RagCallError, withRetry } = await import('../src/rag/resilience.ts');
const { AGENT_MAX_TOOL_STEPS, AGENT_WALL_CLOCK_MS, RAG_RETRY_MAX, RAG_TIMEOUT_MS } = await import(
  '../src/config.ts'
);

report(RAG_TIMEOUT_MS === 1000, 'RAG timeout reads env', String(RAG_TIMEOUT_MS));
report(RAG_RETRY_MAX === 1, 'RAG retry reads env', String(RAG_RETRY_MAX));
report(AGENT_WALL_CLOCK_MS === 1000, 'agent wall clock reads env', String(AGENT_WALL_CLOCK_MS));
report(AGENT_MAX_TOOL_STEPS === 2, 'agent tool step limit reads env', String(AGENT_MAX_TOOL_STEPS));

let attempts = 0;
const recovered = await withRetry(
  '测试恢复',
  async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary');
    return 'ok';
  },
  { retries: 2, baseMs: 10, jitterMs: 1 },
);
report(recovered === 'ok' && attempts === 3, 'withRetry retries then succeeds', `${attempts} attempts`);

let exhausted = 0;
let exhaustedError: unknown = null;
try {
  await withRetry(
    '测试耗尽',
    async () => {
      exhausted += 1;
      throw new RagCallError('TEST_FAILED', 'boom', true);
    },
    { retries: 1, baseMs: 10, jitterMs: 1 },
  );
} catch (error) {
  exhaustedError = error;
}
report(
  exhausted === 2 && exhaustedError instanceof RagCallError && exhaustedError.code === 'TEST_FAILED',
  'withRetry stops after retry budget',
  `${exhausted} attempts`,
);

const hang = createServer(() => {
  // 故意不响应，验证 fetch 超时可中断
});
await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', () => resolve()));
const hangPort = (hang.address() as AddressInfo).port;
process.env.LLM_BASE_URL = `http://127.0.0.1:${hangPort}/v1`;
process.env.LLM_API_KEY = 'test-key';
process.env.EMBEDDING_MODEL = 'test-embedding';

const { embedTexts } = await import('../src/rag/embedding.ts');
const started = Date.now();
let embeddingError: unknown = null;
try {
  await embedTexts(['超时探针']);
} catch (error) {
  embeddingError = error;
}
const elapsed = Date.now() - started;
report(
  embeddingError instanceof RagCallError && embeddingError.code === 'RAG_TIMEOUT',
  'embedding fetch times out and maps to RAG_TIMEOUT',
  `${elapsed}ms`,
);
report(elapsed < 6000, 'embedding timeout returns promptly', `${elapsed}ms`);

const { rerank } = await import('../src/rag/rerank.ts');
const rerankStarted = Date.now();
let rerankError: unknown = null;
try {
  await rerank('超时探针', ['文档一', '文档二'], 2);
} catch (error) {
  rerankError = error;
}
const rerankElapsed = Date.now() - rerankStarted;
report(
  rerankError instanceof RagCallError && rerankError.code === 'RAG_TIMEOUT',
  'rerank fetch times out and maps to RAG_TIMEOUT',
  `${rerankElapsed}ms`,
);
hang.close();

const milvusSource = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('../src/rag/milvus.ts', import.meta.url), 'utf8'),
);
report(
  milvusSource.includes('timeout: MILVUS_TIMEOUT_MS') &&
    milvusSource.includes('maxRetries: RAG_RETRY_MAX') &&
    milvusSource.includes("'MILVUS_UNAVAILABLE'"),
  'Milvus client and search carry explicit timeout/retry and map errors',
);

const { db } = await import('../src/store.ts');
const { startQueue } = await import('../src/tasks/queue.ts');
const taskId = `resilience-${Date.now()}`;
db.prepare(
  `INSERT INTO tasks (task_id, learner_id, type, status, payload, attempts, created_at)
   VALUES (?, 'default', 'unknown', 'queued', '{}', 0, ?)`,
).run(taskId, Date.now());
startQueue();
const deadline = Date.now() + 10_000;
let taskRow: { status: string; attempts: number } | undefined;
while (Date.now() < deadline) {
  taskRow = db.prepare('SELECT status, attempts FROM tasks WHERE task_id = ?').get(taskId) as
    | { status: string; attempts: number }
    | undefined;
  if (taskRow && (taskRow.status === 'failed' || taskRow.status === 'done')) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
report(
  taskRow?.status === 'failed' && taskRow.attempts === 2,
  'task failure retries then fails within budget',
  JSON.stringify(taskRow),
);

const { readFile } = await import('node:fs/promises');
const piSource = await readFile(new URL('../src/pi.ts', import.meta.url), 'utf8');
report(
  piSource.includes("'tool_execution_start'") &&
    piSource.includes('AGENT_MAX_TOOL_STEPS') &&
    piSource.includes('AGENT_TOKEN_BUDGET') &&
    piSource.includes("type: 'incomplete'") &&
    piSource.includes('AbortSignal.any'),
  'agent loop uses verified SDK event, token budget and abort signal',
);
const queueSource = await readFile(new URL('../src/tasks/queue.ts', import.meta.url), 'utf8');
report(
  piSource.includes('const rotated =') && piSource.includes('rotated.slice(0, LLM_KEY_MAX_ATTEMPTS)'),
  'main chat rotates key start then caps attempts',
);

report(
  queueSource.includes('controller.abort()') && queueSource.includes('TASK_RETRY_MAX'),
  'task watchdog aborts execute and retries within budget',
);

// C03：quiz 分支必须把 watchdog 的 signal 贯穿到学习模块，否则超时后模型调用仍在后台空跑。
const quizSource = await readFile(new URL('../src/learning/quiz.ts', import.meta.url), 'utf8');
report(
  queueSource.includes('signal,') &&
    quizSource.includes('signal: input.signal') &&
    quizSource.includes('input.signal?.aborted'),
  'quiz branch forwards watchdog signal into learning module',
);
const { generateQuiz } = await import('../src/learning/quiz.ts');
const abortedController = new AbortController();
abortedController.abort();
let quizCancelled = false;
try {
  await generateQuiz({ knowledgePoint: '勾股定理', signal: abortedController.signal });
} catch (error) {
  quizCancelled = error instanceof DOMException && error.name === 'AbortError';
}
report(quizCancelled, 'quiz generation aborts before model call when watchdog fires');

db.close();
await rm(dataDir, { recursive: true, force: true });

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
