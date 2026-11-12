import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db } from '../store.ts';
import { generateQuiz, startSession } from '../learning/quiz.ts';
import { chat } from '../pi.ts';
import { currentLearnerId, runWithLearner } from '../learning/context.ts';
import { TASK_RETRY_MAX } from '../config.ts';

export type TaskType = 'quiz' | 'analysis';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout' | 'cancelled';

export interface TaskRow {
  task_id: string;
  learner_id: string;
  type: TaskType;
  status: TaskStatus;
  payload: string;
  result: string | null;
  error: string | null;
  attempts: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export const taskEvents = new EventEmitter();

const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS ?? 180_000);
let running = false;
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
const controllers = new Map<string, AbortController>();

function row(id: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(id) as unknown as TaskRow | undefined;
}

function update(id: string, patch: Partial<Pick<TaskRow, 'status' | 'result' | 'error' | 'started_at' | 'finished_at' | 'attempts'>>) {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return;
  db.prepare(`UPDATE tasks SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE task_id = ?`).run(
    ...fields.map(([, v]) => v as string | number | null),
    id,
  );
}

export function emitTask(id: string) {
  const task = row(id);
  if (task) taskEvents.emit('task', task);
}

export function enqueue(type: TaskType, payload: Record<string, unknown>): TaskRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (task_id, learner_id, type, status, payload, attempts, created_at) VALUES (?, ?, ?, 'queued', ?, 0, ?)`,
  ).run(id, currentLearnerId(), type, JSON.stringify(payload), Date.now());
  emitTask(id);
  setImmediate(() => void drain());
  return row(id)!;
}

export function listTasks(limit = 50): TaskRow[] {
  return db
    .prepare('SELECT * FROM tasks WHERE learner_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(currentLearnerId(), limit) as unknown as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
  return db
    .prepare('SELECT * FROM tasks WHERE task_id = ? AND learner_id = ?')
    .get(id, currentLearnerId()) as unknown as TaskRow | undefined;
}

export function cancelTask(id: string): TaskRow | undefined {
  const task = getTask(id);
  if (!task) return undefined;
  if (task.status === 'queued') {
    update(id, { status: 'cancelled', finished_at: Date.now() });
    emitTask(id);
  } else if (task.status === 'running') {
    controllers.get(id)?.abort();
    update(id, { status: 'cancelled', finished_at: Date.now() });
    emitTask(id);
  }
  return getTask(id);
}

/** 服务重启后把 queued/running 任务重新入队（可续任务） */
export function recoverTasks(): void {
  db.prepare(
    `UPDATE tasks SET status = 'queued', attempts = attempts + 1, started_at = NULL
     WHERE status IN ('queued', 'running') AND attempts < 3`,
  ).run();
  db.prepare(`UPDATE tasks SET status = 'failed', error = '恢复次数超限', finished_at = ? WHERE status = 'running'`).run(
    Date.now(),
  );
  setImmediate(() => void drain());
}

async function execute(task: TaskRow, signal: AbortSignal): Promise<unknown> {
  const payload = JSON.parse(task.payload) as Record<string, unknown>;
  if (task.type === 'quiz') {
    const questions = await generateQuiz({
      knowledgePoint: String(payload.knowledge_point ?? '综合'),
      difficulty: payload.difficulty ? String(payload.difficulty) : undefined,
      count: payload.count ? Number(payload.count) : 3,
      subject: payload.subject ? String(payload.subject) : undefined,
      signal,
    });
    const sessionId = startSession({
      type: 'practice',
      title: `${String(payload.knowledge_point ?? '综合')} 练习（后台）`,
      subject: payload.subject ? String(payload.subject) : undefined,
      questionIds: questions.map((q) => q.question_id),
    });
    return { session_id: sessionId, count: questions.length };
  }
  if (task.type === 'analysis') {
    const text = await chat(
      `task-${task.task_id}`,
      String(payload.question ?? '请给我一份当前学习诊断报告'),
      () => {},
      signal,
      'analyst',
    );
    return { reply: text };
  }
  throw new Error(`未知任务类型: ${task.type}`);
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = db
        .prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as TaskRow | undefined;
      if (!next) break;

      update(next.task_id, { status: 'running', started_at: Date.now() });
      emitTask(next.task_id);

      const controller = new AbortController();
      controllers.set(next.task_id, controller);
      const watchdog = setTimeout(() => {
        // 真正中止任务，而不是只改状态后让它在后台空跑
        controller.abort();
        update(next.task_id, { status: 'timeout', error: `超过 ${TIMEOUT_MS}ms 未完成`, finished_at: Date.now() });
        emitTask(next.task_id);
      }, TIMEOUT_MS);
      timeouts.set(next.task_id, watchdog);

      try {
        const result = await runWithLearner(
          { learnerId: next.learner_id, userId: next.learner_id, role: 'user' },
          () => execute(next, controller.signal),
        );
        const current = row(next.task_id);
        if (current?.status === 'running') {
          update(next.task_id, { status: 'done', result: JSON.stringify(result), finished_at: Date.now() });
          emitTask(next.task_id);
        }
      } catch (e) {
        const current = row(next.task_id);
        if (current?.status === 'running') {
          const attempts = current.attempts + 1;
          const message = e instanceof Error ? e.message : String(e);
          if (attempts <= TASK_RETRY_MAX) {
            update(next.task_id, { status: 'queued', attempts, started_at: null, error: message });
            emitTask(next.task_id);
            // 重排后立即停掉本轮 watchdog，避免退避期间把 queued 覆盖成 timeout
            const pending = timeouts.get(next.task_id);
            if (pending) clearTimeout(pending);
            timeouts.delete(next.task_id);
            const backoffMs = Math.min(30_000, 1000 * 2 ** (attempts - 1)) + Math.random() * 300;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          } else {
            update(next.task_id, {
              status: 'failed',
              attempts,
              error: message,
              finished_at: Date.now(),
            });
            emitTask(next.task_id);
          }
        }
      } finally {
        const t = timeouts.get(next.task_id);
        if (t) clearTimeout(t);
        timeouts.delete(next.task_id);
        controllers.delete(next.task_id);
      }
    }
  } finally {
    running = false;
  }
}

export function startQueue(): void {
  recoverTasks();
}