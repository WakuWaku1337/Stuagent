/**
 * C01 回归：SSE 断线重发幂等。
 * 静态断言前后端接线；运行时断言去重表的状态流转与按账号隔离。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/check-sse-idempotency.ts
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-idem-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const { runWithLearner } = await import('../src/learning/context.ts');
const idem = await import('../src/chat/idempotency.ts');

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const frontSource = await readFile(new URL('../../web/src/api/chat.ts', import.meta.url), 'utf8');
report(
  frontSource.includes('clientRequestId') &&
    frontSource.includes('const clientRequestId = newClientRequestId()') &&
    frontSource.includes('receivedAny'),
  'frontend generates one id per send and reuses it across retries',
);

const handlerSource = await readFile(new URL('../src/chat/handler.ts', import.meta.url), 'utf8');
report(
  handlerSource.includes('lookupIdempotency') &&
    handlerSource.includes('beginIdempotency') &&
    handlerSource.includes('completeIdempotency') &&
    handlerSource.includes('failIdempotency') &&
    handlerSource.includes('replayIdempotent'),
  'chat handler wires lookup, begin, complete, fail and replay',
);

const storeSource = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
report(
  storeSource.includes('CREATE TABLE IF NOT EXISTS chat_idempotency') &&
    storeSource.includes('PRIMARY KEY (learner_id, request_id)'),
  'idempotency table is keyed by learner and request id',
);

const requestId = 'req-abcdefgh-1234';
report(idem.normalizeRequestId(requestId) === requestId, 'valid request id accepted');
report(idem.normalizeRequestId('bad id!') === null, 'invalid request id rejected');
report(idem.lookupIdempotency(requestId).status === 'none', 'new request starts with no record');
report(idem.beginIdempotency(requestId), 'first request takes ownership');
report(!idem.beginIdempotency(requestId), 'concurrent duplicate cannot take ownership');
report(idem.lookupIdempotency(requestId).status === 'processing', 'in-flight request is visible');

const response: idem.IdempotentResponse = {
  conversation: { type: 'conversation', conversation_id: 'conv-1' },
  media: { type: 'media', vision: false },
  route: { agent: 'tutor', agent_name: '主讲', reason: '默认入口' },
  security: {},
  citations: [],
  text: '答案',
  json: { reply: '答案', conversation_id: 'conv-1' },
};
idem.completeIdempotency(requestId, 'conv-1', response);
const done = idem.lookupIdempotency(requestId);
report(
  done.status === 'done' && done.response.text === '答案' && done.conversationId === 'conv-1',
  'completed response is replayable',
);
report(!idem.beginIdempotency(requestId), 'completed request cannot be restarted');
idem.failIdempotency(requestId);
report(idem.lookupIdempotency(requestId).status === 'done', 'fail does not erase a completed result');

const failedId = 'req-failed-000001';
idem.beginIdempotency(failedId);
idem.failIdempotency(failedId);
report(idem.lookupIdempotency(failedId).status === 'none', 'failed request releases ownership');

const scopedId = 'req-scoped-000001';
idem.beginIdempotency(scopedId);
const otherLearner = runWithLearner(
  { learnerId: 'user-b', userId: 'user-b', role: 'user' },
  () => idem.lookupIdempotency(scopedId),
);
report(otherLearner.status === 'none', 'idempotency key is scoped per learner');

db.close();
await rm(dataDir, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
