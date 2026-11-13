import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-multiuser-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.ANSWER_CACHE_TTL_MIN = '60';

const { SessionCache } = await import('../src/chat/session-cache.ts');
const { orderKeyCandidates } = await import('../src/chat/key-selection.ts');
const { ChatGate, ChatBusyError } = await import('../src/chat/gate.ts');
const {
  acquireConversationLock,
  isConversationBusy,
} = await import('../src/chat/lock.ts');
const { db } = await import('../src/store.ts');
const { runMaintenance } = await import('../src/maintenance.ts');

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

try {
  // 1. SessionCache LRU + TTL
  const cache = new SessionCache<string>({ max: 2, ttlMs: 1000 });
  cache.set('a', 'A', 0);
  cache.set('b', 'B', 0);
  report(cache.get('a', 10) === 'A', 'cache hit refreshes entry');
  cache.set('c', 'C', 20);
  report(
    cache.get('b', 30) === undefined && cache.get('a', 30) === 'A' && cache.get('c', 30) === 'C',
    'cache evicts least recently used',
  );
  report(cache.get('a', 2000) === undefined, 'cache expires idle entries');

  // 2. Key selection
  const available = [{ keyId: 'a' }, { keyId: 'b' }, { keyId: 'c' }];
  const pinned = orderKeyCandidates(available, 'b', 0, 3);
  report(pinned.ordered.map((item) => item.keyId).join('') === 'bac', 'pinned key goes first');
  report(pinned.nextCursor === 1, 'cursor advances');

  const rotated = orderKeyCandidates(available, undefined, 1, 3);
  report(rotated.ordered.map((item) => item.keyId).join('') === 'bca', 'rotation starts at cursor');

  const missingPin = orderKeyCandidates(available, 'zzz', 0, 3);
  report(missingPin.ordered.map((item) => item.keyId).join('') === 'abc', 'missing pin falls back');

  const capped = orderKeyCandidates(available, 'b', 0, 2);
  report(capped.ordered.map((item) => item.keyId).join('') === 'ba', 'max attempts caps candidates');

  // 3. Conversation lock
  const release = acquireConversationLock('conv-1', 'owner-1');
  report(release !== null && isConversationBusy('conv-1'), 'conversation lock acquires');
  report(acquireConversationLock('conv-1', 'owner-2') === null, 'conversation lock rejects second owner');
  release?.();
  report(!isConversationBusy('conv-1'), 'conversation lock releases');
  const again = acquireConversationLock('conv-1', 'owner-3');
  report(again !== null, 'conversation lock can be re-acquired');
  again?.();

  // 4. ChatGate
  const gate = new ChatGate({ max: 2, perUserMax: 1, waitMs: 100 });
  const first = await gate.acquire('u1');
  let perUserRejected = false;
  try {
    await gate.acquire('u1');
  } catch (error) {
    perUserRejected = error instanceof ChatBusyError;
  }
  report(perUserRejected, 'gate rejects second request from same user');

  const second = await gate.acquire('u2');
  const started = Date.now();
  let globalTimedOut = false;
  try {
    await gate.acquire('u3');
  } catch (error) {
    globalTimedOut = error instanceof ChatBusyError;
  }
  report(globalTimedOut && Date.now() - started >= 80, 'gate queues then times out when global full');
  first();
  second();

  const queueGate = new ChatGate({ max: 1, perUserMax: 1, waitMs: 500 });
  const holder = await queueGate.acquire('u1');
  const waiting = queueGate.acquire('u2');
  setTimeout(() => holder(), 20);
  const acquired = await waiting;
  report(typeof acquired === 'function', 'gate wakes queued request after release');
  acquired();

  // 5. Maintenance
  const now = Date.now();
  const old = now - 10 * 86_400_000;
  const oldTask = now - 40 * 86_400_000;
  db.prepare(
    `INSERT INTO chat_idempotency (learner_id, request_id, status, response_json, conversation_id, created_at)
     VALUES ('default', 'old-idem', 'done', '{}', NULL, ?)`,
  ).run(now - 25 * 3_600_000);
  db.prepare(
    `INSERT INTO chat_idempotency (learner_id, request_id, status, response_json, conversation_id, created_at)
     VALUES ('default', 'new-idem', 'done', '{}', NULL, ?)`,
  ).run(now);

  db.prepare(
    `INSERT INTO answer_cache (cache_key, learner_id, answer, citations, created_at)
     VALUES ('old-cache', 'default', 'old', NULL, ?)`,
  ).run(old);
  db.prepare(
    `INSERT INTO answer_cache (cache_key, learner_id, answer, citations, created_at)
     VALUES ('new-cache', 'default', 'new', NULL, ?)`,
  ).run(now);

  db.prepare(
    `INSERT INTO tasks (task_id, learner_id, type, status, payload, result, error, attempts, created_at, started_at, finished_at)
     VALUES ('old-task', 'default', 'quiz', 'done', '{}', NULL, NULL, 1, ?, ?, ?)`,
  ).run(oldTask, oldTask, oldTask);
  db.prepare(
    `INSERT INTO tasks (task_id, learner_id, type, status, payload, result, error, attempts, created_at, started_at, finished_at)
     VALUES ('running-task', 'default', 'quiz', 'running', '{}', NULL, NULL, 1, ?, ?, NULL)`,
  ).run(oldTask, oldTask);
  db.prepare(
    `INSERT INTO tasks (task_id, learner_id, type, status, payload, result, error, attempts, created_at, started_at, finished_at)
     VALUES ('new-task', 'default', 'quiz', 'done', '{}', NULL, NULL, 1, ?, ?, ?)`,
  ).run(now, now, now);

  const result = runMaintenance(now);
  const count = (sql: string, ...params: unknown[]): number =>
    Number((db.prepare(sql).get(...params) as unknown as { c: number }).c);

  report(result.idempotency === 1, 'maintenance deletes old idempotency row', `removed=${result.idempotency}`);
  report(
    count('SELECT COUNT(*) c FROM chat_idempotency WHERE request_id = ?', 'new-idem') === 1,
    'maintenance keeps fresh idempotency row',
  );
  report(result.answerCache === 1, 'maintenance deletes old answer cache', `removed=${result.answerCache}`);
  report(
    count('SELECT COUNT(*) c FROM answer_cache WHERE cache_key = ?', 'new-cache') === 1,
    'maintenance keeps fresh answer cache',
  );
  report(result.tasks === 1, 'maintenance deletes old finished task', `removed=${result.tasks}`);
  report(
    count('SELECT COUNT(*) c FROM tasks WHERE task_id = ?', 'running-task') === 1,
    'maintenance keeps running task',
  );
  report(
    count('SELECT COUNT(*) c FROM tasks WHERE task_id = ?', 'new-task') === 1,
    'maintenance keeps fresh finished task',
  );

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}