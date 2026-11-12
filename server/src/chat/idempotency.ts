/**
 * C01：SSE 断线重发幂等。
 *
 * 「未收到任何事件」只能避免已输出 delta 后的重复生成，挡不住服务端在首事件前
 * 已创建会话/落库用户消息的情况。客户端每次发送生成 clientRequestId，重发复用同一个；
 * 服务端按 (learner_id, clientRequestId) 去重：命中已完成记录直接重放原响应，不重复落库、
 * 不重复调用模型；命中 processing 返回 409，交由客户端终止重连。
 *
 * 去重窗口 5 分钟，避免一次异常中断永久阻断后续合理请求。
 */
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../store.ts';
import { currentLearnerId } from '../learning/context.ts';
import type { Citation } from '../rag/service.ts';

const WINDOW_MS = 5 * 60_000;

export interface IdempotentResponse {
  conversation: Record<string, unknown>;
  media: Record<string, unknown>;
  route: { agent: string; agent_name: string; reason: string };
  security: Record<string, unknown>;
  citations: Citation[];
  text: string;
  /** 非流式完整响应体，重放时补当前 trace_id */
  json: Record<string, unknown>;
}

interface Row {
  status: 'processing' | 'done';
  response_json: string | null;
  conversation_id: string | null;
  created_at: number;
}

export function normalizeRequestId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : null;
}

function read(requestId: string): Row | undefined {
  return db
    .prepare(
      `SELECT status, response_json, conversation_id, created_at
       FROM chat_idempotency WHERE learner_id = ? AND request_id = ?`,
    )
    .get(currentLearnerId(), requestId) as unknown as Row | undefined;
}

function forget(requestId: string): void {
  db.prepare('DELETE FROM chat_idempotency WHERE learner_id = ? AND request_id = ?').run(
    currentLearnerId(),
    requestId,
  );
}

export type IdempotencyLookup =
  | { status: 'none' }
  | { status: 'processing' }
  | { status: 'done'; response: IdempotentResponse; conversationId: string };

export function lookupIdempotency(requestId: string): IdempotencyLookup {
  const row = read(requestId);
  if (!row) return { status: 'none' };
  if (row.status === 'processing') {
    if (Date.now() - row.created_at > WINDOW_MS) {
      forget(requestId);
      return { status: 'none' };
    }
    return { status: 'processing' };
  }
  if (!row.response_json) {
    forget(requestId);
    return { status: 'none' };
  }
  try {
    return {
      status: 'done',
      response: JSON.parse(row.response_json) as IdempotentResponse,
      conversationId: row.conversation_id ?? '',
    };
  } catch {
    forget(requestId);
    return { status: 'none' };
  }
}

/** 抢到执行权返回 true；并发重复请求返回 false。 */
export function beginIdempotency(requestId: string): boolean {
  return (
    db
      .prepare(
        `INSERT INTO chat_idempotency (learner_id, request_id, status, response_json, conversation_id, created_at)
         VALUES (?, ?, 'processing', NULL, NULL, ?)
         ON CONFLICT(learner_id, request_id) DO NOTHING`,
      )
      .run(currentLearnerId(), requestId, Date.now()).changes > 0
  );
}

export function completeIdempotency(
  requestId: string,
  conversationId: string,
  response: IdempotentResponse,
): void {
  db.prepare(
    `UPDATE chat_idempotency
     SET status = 'done', response_json = ?, conversation_id = ?, created_at = ?
     WHERE learner_id = ? AND request_id = ? AND status = 'processing'`,
  ).run(JSON.stringify(response), conversationId, Date.now(), currentLearnerId(), requestId);
}

/** 失败后释放执行权，允许客户端带同一 key 重新走完整流程。 */
export function failIdempotency(requestId: string): void {
  db.prepare(
    `DELETE FROM chat_idempotency
     WHERE learner_id = ? AND request_id = ? AND status = 'processing'`,
  ).run(currentLearnerId(), requestId);
}

export function replayIdempotent(
  c: Context,
  response: IdempotentResponse,
  stream: boolean,
  traceId: string,
): Response {
  if (!stream) return c.json({ ...response.json, trace_id: traceId, replayed: true });
  return streamSSE(c, async (sse) => {
    const emit = (event: string, data: Record<string, unknown>) =>
      sse.writeSSE({ event, data: JSON.stringify({ ...data, trace_id: traceId }) });
    await emit('conversation', response.conversation);
    await emit('media', { type: 'media', ...response.media });
    await emit('route', {
      type: 'route',
      ...response.route,
      reason: `${response.route.reason} · 幂等重放`,
    });
    if (Object.keys(response.security).length > 0) {
      await emit('security', { type: 'security', ...response.security });
    }
    if (response.citations.length > 0) {
      await emit('citations', { type: 'citations', citations: response.citations });
    }
    await emit('delta', { type: 'delta', text: response.text });
    await emit('done', { type: 'done', text: response.text, cached: true, replayed: true });
  });
}
