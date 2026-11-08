import { Hono } from 'hono';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  updateConversation,
} from '../conversations/service.ts';
import { handleChat, type ChatBody } from '../chat/handler.ts';
import { dropConversationSessions } from '../pi.ts';
import { releaseUnreferencedMedia } from '../media/service.ts';
import { conversationMediaIds } from '../storage/refs.ts';

const conversations = new Hono();

conversations.get('/', (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  const result = listConversations({
    q: c.req.query('q') ?? '',
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return c.json(result);
});

conversations.post('/', async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => null);
  const title = body?.title?.trim();
  if (title && title.length > 60) return c.json({ error: '标题不能超过 60 字' }, 400);
  return c.json(createConversation(title), 201);
});

conversations.get('/:id', (c) => {
  const conversation = getConversation(c.req.param('id'));
  if (!conversation) return c.json({ error: '会话不存在' }, 404);
  const limit = Number(c.req.query('limit') ?? 30);
  const before = c.req.query('before') || undefined;
  try {
    const page = listMessages(conversation.conversation_id, {
      limit: Number.isFinite(limit) ? limit : 30,
      before,
    });
    return c.json({ conversation, ...page });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

conversations.get('/:id/messages', (c) => {
  const conversation = getConversation(c.req.param('id'));
  if (!conversation) return c.json({ error: '会话不存在' }, 404);
  const limit = Number(c.req.query('limit') ?? 30);
  const before = c.req.query('before') || undefined;
  try {
    return c.json(
      listMessages(conversation.conversation_id, {
        limit: Number.isFinite(limit) ? limit : 30,
        before,
      }),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

conversations.put('/:id', async (c) => {
  const body = await c.req.json<{ title?: string; pinned?: boolean }>().catch(() => null);
  if (!body) return c.json({ error: '请求体必须是 JSON' }, 400);
  if (body.title === undefined && body.pinned === undefined) {
    return c.json({ error: 'title 或 pinned 至少提供一个' }, 400);
  }
  const patch: { title?: string; pinned?: boolean } = {};
  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) return c.json({ error: '标题不能为空' }, 400);
    if (title.length > 60) return c.json({ error: '标题不能超过 60 字' }, 400);
    patch.title = title;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') return c.json({ error: 'pinned 必须是布尔值' }, 400);
    patch.pinned = body.pinned;
  }
  const updated = updateConversation(c.req.param('id'), patch);
  return updated ? c.json(updated) : c.json({ error: '会话不存在' }, 404);
});

conversations.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const mediaIds = conversationMediaIds(id);
  if (!deleteConversation(id)) return c.json({ error: '会话不存在' }, 404);
  dropConversationSessions(id);
  const released = await releaseUnreferencedMedia(mediaIds);
  return c.json({
    deleted: id,
    media_removed: released.removed,
    bytes_freed: released.bytes,
  });
});

conversations.post('/:id/messages', async (c) => {
  const conversation = getConversation(c.req.param('id'));
  if (!conversation) return c.json({ error: '会话不存在' }, 404);
  const body = await c.req.json<ChatBody>().catch(() => null);
  if (!body) return c.json({ error: '请求体必须是 JSON' }, 400);
  return handleChat(c, body, conversation);
});

export default conversations;
