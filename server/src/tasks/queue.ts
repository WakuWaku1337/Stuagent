import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db } from '../store.ts';
import { generateQuiz, startSession } from '../learning/quiz.ts';
import { chat } from '../pi.ts';

export type TaskType = 'quiz' | 'analysis';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout' | 'cancelled';

export interface TaskRow {
  task_id: string;
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
    `INSERT INTO tasks (task_id, type, status, payload, attempts, created_at) VALUES (?, ?, 'queued', ?, 0, ?)`,
  ).run(id, type, JSON.stringify(payload), Date.now());
  emitTask(id);
  setImmediate(() => void drain());
  return row(id)!;
}

export function listTasks(limit = 50): TaskRow[] {
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as TaskRow[];
}

export function getTask(id: string): TaskRow | undefined {
  return row(id);
}

export function cancelTask(id: string): TaskRow | undefined {
  const task = row(id);
  if (!task) return undefined;
  if (task.status === 'queued') {
    update(id, { status: 'cancelled', finished_at: Date.now() });
    emitTask(id);
  }
  return row(id);
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

async function execute(task: TaskRow): Promise<unknown> {
  const payload = JSON.parse(task.payload) as Record<string, unknown>;
  if (task.type === 'quiz') {
    const questions = await generateQuiz({
      knowledgePoint: String(payload.knowledge_point ?? '综合'),
      difficulty: payload.difficulty ? String(payload.difficulty) : undefined,
      count: payload.count ? Number(payload.count) : 3,
      subject: payload.subject ? String(payload.subject) : undefined,
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
      undefined,
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

      const watchdog = setTimeout(() => {
        update(next.task_id, { status: 'timeout', error: `超过 ${TIMEOUT_MS}ms 未完成`, finished_at: Date.now() });
        emitTask(next.task_id);
      }, TIMEOUT_MS);
      timeouts.set(next.task_id, watchdog);

      try {
        const result = await execute(next);
        const current = row(next.task_id);
        if (current?.status === 'running') {
          update(next.task_id, { status: 'done', result: JSON.stringify(result), finished_at: Date.now() });
          emitTask(next.task_id);
        }
      } catch (e) {
        const current = row(next.task_id);
        if (current?.status === 'running') {
          update(next.task_id, {
            status: 'failed',
            error: e instanceof Error ? e.message : String(e),
            finished_at: Date.now(),
          });
          emitTask(next.task_id);
        }
      } finally {
        const t = timeouts.get(next.task_id);
        if (t) clearTimeout(t);
        timeouts.delete(next.task_id);
      }
    }
  } finally {
    running = false;
  }
}

export function startQueue(): void {
  recoverTasks();
}