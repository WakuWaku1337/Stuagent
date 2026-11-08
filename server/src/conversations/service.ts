import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { currentLearnerId } from '../learning/context.ts';
import type { Citation } from '../rag/service.ts';

export type MessageRole = 'user' | 'assistant';

export interface Conversation {
  conversation_id: string;
  title: string;
  pinned: boolean;
  title_auto: boolean;
  created_at: number;
  updated_at: number;
  message_count: number;
  preview: string | null;
}

export interface Message {
  message_id: string;
  conversation_id: string;
  role: MessageRole;
  msg_type: string;
  content: string;
  attachments: string | null;
  agent: string | null;
  citations: string | null;
  visualization_id: string | null;
  created_at: number;
}

interface ConversationDbRow {
  conversation_id: string;
  learner_id: string;
  title: string;
  pinned: number;
  title_auto: number;
  created_at: number;
  updated_at: number;
  message_count: number;
  preview: string | null;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

const DEFAULT_TITLE = '新会话';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function flatten(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleFromMessage(text: string): string {
  const clean = flatten(text);
  if (!clean) return DEFAULT_TITLE;
  const chars = Array.from(clean);
  return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : clean;
}

function previewOf(text: string | null): string | null {
  if (!text) return null;
  const clean = flatten(text);
  if (!clean) return null;
  const chars = Array.from(clean);
  return chars.length > 52 ? `${chars.slice(0, 52).join('')}…` : clean;
}

function toConversation(row: ConversationDbRow): Conversation {
  return {
    conversation_id: row.conversation_id,
    title: row.title,
    pinned: row.pinned === 1,
    title_auto: row.title_auto === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    message_count: row.message_count,
    preview: previewOf(row.preview),
  };
}

const summarySelect = `
  SELECT c.*,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id) AS message_count,
    (SELECT m.content FROM messages m WHERE m.conversation_id = c.conversation_id
      ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview
  FROM conversations c`;

function ownsConversation(id: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM conversations WHERE conversation_id = ? AND learner_id = ?').get(id, currentLearnerId()),
  );
}

export function createConversation(title?: string): Conversation {
  const now = Date.now();
  const id = randomUUID();
  const clean = title?.trim();
  db.prepare(
    `INSERT INTO conversations (conversation_id, learner_id, title, pinned, title_auto, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, currentLearnerId(), clean || DEFAULT_TITLE, clean ? 0 : 1, now, now);
  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | undefined {
  const row = db
    .prepare(`${summarySelect} WHERE c.conversation_id = ? AND c.learner_id = ?`)
    .get(id, currentLearnerId()) as ConversationDbRow | undefined;
  return row ? toConversation(row) : undefined;
}

export function listConversations(
  options: { q?: string; limit?: number; offset?: number } = {},
): { conversations: Conversation[]; total: number; hasMore: boolean } {
  const limit = clamp(options.limit ?? 50, 1, 100);
  const offset = Math.max(0, options.offset ?? 0);
  const q = options.q?.trim() ?? '';
  const like = `%${q}%`;
  const where = q
    ? `c.learner_id = ? AND (c.title LIKE ? OR EXISTS (
         SELECT 1 FROM messages m WHERE m.conversation_id = c.conversation_id AND m.content LIKE ?
       ))`
    : 'c.learner_id = ?';
  const params: (string | number)[] = q ? [currentLearnerId(), like, like] : [currentLearnerId()];
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE ${where}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `${summarySelect} WHERE ${where}
       ORDER BY c.pinned DESC, c.updated_at DESC, c.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as ConversationDbRow[];
  return {
    conversations: rows.map(toConversation),
    total,
    hasMore: offset + rows.length < total,
  };
}

export function updateConversation(
  id: string,
  patch: { title?: string; pinned?: boolean },
): Conversation | undefined {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?', 'title_auto = 0');
    values.push(patch.title);
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?');
    values.push(patch.pinned ? 1 : 0);
  }
  if (fields.length > 0) {
    values.push(id, currentLearnerId());
    db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE conversation_id = ? AND learner_id = ?`).run(...values);
  }
  return getConversation(id);
}

export function deleteConversation(id: string): boolean {
  if (!ownsConversation(id)) return false;
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM conversations WHERE conversation_id = ? AND learner_id = ?').run(id, currentLearnerId());
  return true;
}

export function addMessage(
  conversationId: string,
  input: {
    role: MessageRole;
    content: string;
    msgType?: string;
    attachments?: unknown;
    agent?: string | null;
    citations?: Citation[];
    visualizationId?: string | null;
    title?: string;
  },
): Message {
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE conversation_id = ? AND learner_id = ?')
    .get(conversationId, currentLearnerId()) as
    | { title: string; title_auto: number }
    | undefined;
  if (!conversation) throw new Error('会话不存在');

  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO messages (message_id, conversation_id, role, msg_type, content, attachments, agent, citations, visualization_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    conversationId,
    input.role,
    input.msgType ?? 'text',
    input.content,
    input.attachments == null ? null : JSON.stringify(input.attachments),
    input.agent ?? null,
    input.citations?.length ? JSON.stringify(input.citations) : null,
    input.visualizationId ?? null,
    now,
  );

  let title = conversation.title;
  let titleAuto = conversation.title_auto;
  if (input.role === 'user' && titleAuto === 1) {
    title = input.title?.trim() || titleFromMessage(input.content);
    titleAuto = 0;
  }
  db.prepare('UPDATE conversations SET title = ?, title_auto = ?, updated_at = ? WHERE conversation_id = ? AND learner_id = ?').run(
    title,
    titleAuto,
    now,
    conversationId,
    currentLearnerId(),
  );

  return db.prepare('SELECT * FROM messages WHERE message_id = ?').get(id) as unknown as Message;
}

export function lastMessageByRole(conversationId: string, role: MessageRole): Message | undefined {
  if (!ownsConversation(conversationId)) return undefined;
  return db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND role = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(conversationId, role) as unknown as Message | undefined;
}

export function deleteMessage(messageId: string): boolean {
  return (
    db
      .prepare(
        'DELETE FROM messages WHERE message_id = ? AND conversation_id IN (SELECT conversation_id FROM conversations WHERE learner_id = ?)',
      )
      .run(messageId, currentLearnerId()).changes > 0
  );
}

export function setMessageVisualization(messageId: string, visualizationId: string): boolean {
  return (
    db
      .prepare(
        'UPDATE messages SET visualization_id = ? WHERE message_id = ? AND conversation_id IN (SELECT conversation_id FROM conversations WHERE learner_id = ?)',
      )
      .run(visualizationId, messageId, currentLearnerId()).changes > 0
  );
}

export function listMessages(
  conversationId: string,
  options: { limit?: number; before?: string } = {},
): MessagePage {  const limit = clamp(options.limit ?? 30, 1, 100);
  if (!ownsConversation(conversationId)) throw new Error('会话不存在');
  let cursor: { created_at: number; rid: number } | undefined;
  if (options.before) {
    cursor = db
      .prepare(
        'SELECT created_at, rowid AS rid FROM messages WHERE message_id = ? AND conversation_id = ?',
      )
      .get(options.before, conversationId) as { created_at: number; rid: number } | undefined;
    if (!cursor) throw new Error('分页游标不存在');
  }

  const rows = (
    cursor
      ? db
          .prepare(
            `SELECT rowid AS rid, * FROM messages
             WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(conversationId, cursor.created_at, cursor.created_at, cursor.rid, limit + 1)
      : db
          .prepare(
            `SELECT rowid AS rid, * FROM messages WHERE conversation_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(conversationId, limit + 1)
  ) as unknown as (Message & { rid: number })[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(({ rid: _rid, ...message }) => message).reverse();
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conversationId) as {
      n: number;
    }
  ).n;

  return {
    messages: page,
    hasMore,
    nextCursor: hasMore && page.length > 0 ? page[0].message_id : null,
    total,
  };
}
