import { http } from './http';
import type { Citation } from './chat';

export interface ConversationItem {
  conversation_id: string;
  title: string;
  pinned: boolean;
  title_auto: boolean;
  created_at: number;
  updated_at: number;
  message_count: number;
  preview: string | null;
}

export interface ConversationMessage {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  msg_type: string;
  content: string;
  attachments: string | null;
  agent: string | null;
  citations: string | null;
  created_at: number;
}

export interface MessagePage {
  messages: ConversationMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

export interface ConversationDetail extends MessagePage {
  conversation: ConversationItem;
}

export interface ConversationList {
  conversations: ConversationItem[];
  total: number;
  hasMore: boolean;
}

export async function fetchConversations(
  params: { q?: string; limit?: number; offset?: number } = {},
): Promise<ConversationList> {
  const { data } = await http.get<ConversationList>('/api/conversations', {
    params: {
      q: params.q?.trim() || undefined,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  });
  return data;
}

export async function fetchConversation(
  id: string,
  limit = 30,
  before?: string | null,
): Promise<ConversationDetail> {
  const { data } = await http.get<ConversationDetail>(
    `/api/conversations/${encodeURIComponent(id)}`,
    { params: { limit, before: before || undefined } },
  );
  return data;
}

export async function createConversation(title?: string): Promise<ConversationItem> {
  const { data } = await http.post<ConversationItem>('/api/conversations', title ? { title } : {});
  return data;
}

export async function updateConversation(
  id: string,
  patch: { title?: string; pinned?: boolean },
): Promise<ConversationItem> {
  const { data } = await http.put<ConversationItem>(
    `/api/conversations/${encodeURIComponent(id)}`,
    patch,
  );
  return data;
}

export async function deleteConversation(id: string): Promise<void> {
  await http.delete(`/api/conversations/${encodeURIComponent(id)}`);
}

export function parseCitations(raw: string | null): Citation[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Citation[]) : undefined;
  } catch {
    return undefined;
  }
}
