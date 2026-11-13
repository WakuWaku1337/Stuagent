import { AGENT_WALL_CLOCK_MS } from '../config.ts';

interface LockEntry {
  ownerId: string;
  startedAt: number;
}

export class ConversationBusyError extends Error {
  readonly code = 'CONVERSATION_BUSY';

  constructor(message = '该会话正在生成回复，请稍后再试') {
    super(message);
    this.name = 'ConversationBusyError';
  }
}

const locks = new Map<string, LockEntry>();
const STALE_MS = Math.max(60_000, AGENT_WALL_CLOCK_MS + 60_000);

function isStale(entry: LockEntry, now: number): boolean {
  return now - entry.startedAt >= STALE_MS;
}

/**
 * 会话级互斥锁：同一会话同时只允许一个生成任务。
 *
 * 成功返回 release；已被占用时返回 null。锁带过期时间，避免异常路径永久锁死会话。
 */
export function acquireConversationLock(
  conversationId: string,
  ownerId: string,
): (() => void) | null {
  const now = Date.now();
  const existing = locks.get(conversationId);
  if (existing && !isStale(existing, now)) return null;

  locks.set(conversationId, { ownerId, startedAt: now });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = locks.get(conversationId);
    if (current?.ownerId === ownerId) locks.delete(conversationId);
  };
}

export function isConversationBusy(conversationId: string): boolean {
  const existing = locks.get(conversationId);
  if (!existing) return false;
  if (isStale(existing, Date.now())) {
    locks.delete(conversationId);
    return false;
  }
  return true;
}

export function conversationLockCount(): number {
  return locks.size;
}