import { defineStore } from 'pinia';
import { ref } from 'vue';
import { streamChatIn, type Citation } from '../api/chat';
import {
  deleteConversation as apiDeleteConversation,
  fetchConversation,
  fetchConversations,
  parseCitations,
  updateConversation as apiUpdateConversation,
  type ConversationItem,
  type ConversationMessage,
} from '../api/conversations';

export interface ChatMessage {
  message_id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  agent?: string;
  created_at?: number;
}

interface RecentCacheEntry {
  savedAt: number;
  messages: ChatMessage[];
}

const LIST_CACHE_KEY = 'edupi.chat.conversations.v1';
const RECENT_CACHE_KEY = 'edupi.chat.recent.v1';
const RECENT_LIMIT = 5;
const CACHE_TTL = 12 * 60 * 60 * 1000;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额或隐私模式下忽略缓存失败
  }
}

function readRecent(): Record<string, RecentCacheEntry> {
  const raw = readJson<Record<string, RecentCacheEntry>>(RECENT_CACHE_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const now = Date.now();
  const valid: Record<string, RecentCacheEntry> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (entry && Array.isArray(entry.messages) && now - entry.savedAt < CACHE_TTL) valid[id] = entry;
  }
  return valid;
}

function writeRecent(cache: Record<string, RecentCacheEntry>): void {
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, RECENT_LIMIT);
  writeJson(RECENT_CACHE_KEY, Object.fromEntries(entries));
}

function fromStored(message: ConversationMessage): ChatMessage {
  return {
    message_id: message.message_id,
    role: message.role,
    content: message.content,
    agent: message.agent ?? undefined,
    citations: parseCitations(message.citations),
    created_at: message.created_at,
  };
}

function errText(error: unknown): string {
  const detail = error as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    detail.response?.data?.error ??
    detail.response?.data?.message ??
    (error instanceof Error ? error.message : String(error))
  );
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const conversations = ref<ConversationItem[]>([]);
  const conversationId = ref('');
  const conversationTitle = ref('');
  const search = ref('');
  const loadingList = ref(false);
  const loadingMessages = ref(false);
  const loadingOlder = ref(false);
  const hasMore = ref(false);
  const nextCursor = ref<string | null>(null);
  const total = ref(0);
  const streaming = ref(false);
  const error = ref('');
  const listError = ref('');

  let controller: AbortController | null = null;
  let listToken = 0;
  let openToken = 0;

  function sortConversations() {
    conversations.value = [...conversations.value].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
      return b.created_at - a.created_at;
    });
  }

  function mergeConversation(item: ConversationItem) {
    const index = conversations.value.findIndex((c) => c.conversation_id === item.conversation_id);
    if (index >= 0) conversations.value[index] = { ...conversations.value[index], ...item };
    else conversations.value.push(item);
    sortConversations();
    writeJson(LIST_CACHE_KEY, conversations.value);
  }

  function cacheRecent(id: string, items: ChatMessage[]) {
    if (!items.length) return;
    const cache = readRecent();
    cache[id] = { savedAt: Date.now(), messages: items.slice(-40) };
    writeRecent(cache);
  }

  function hydrate() {
    if (conversations.value.length > 0) return;
    const cached = readJson<ConversationItem[]>(LIST_CACHE_KEY);
    if (Array.isArray(cached)) conversations.value = cached;
  }

  async function loadConversations(q = search.value) {
    const token = ++listToken;
    loadingList.value = true;
    listError.value = '';
    try {
      const result = await fetchConversations({ q, limit: 60 });
      if (token !== listToken) return;
      conversations.value = result.conversations;
      total.value = result.total;
      writeJson(LIST_CACHE_KEY, result.conversations);
    } catch (e) {
      if (token === listToken) listError.value = errText(e);
    } finally {
      if (token === listToken) loadingList.value = false;
    }
  }

  async function open(id: string) {
    if (!id) return;
    stop();
    const token = ++openToken;
    const cached = readRecent()[id];
    const known = conversations.value.find((c) => c.conversation_id === id);
    conversationId.value = id;
    conversationTitle.value = known?.title ?? '';
    messages.value = cached?.messages ?? [];
    hasMore.value = false;
    nextCursor.value = null;
    error.value = '';
    loadingMessages.value = true;
    try {
      const detail = await fetchConversation(id, 30);
      if (token !== openToken) return;
      conversationTitle.value = detail.conversation.title;
      messages.value = detail.messages.map(fromStored);
      hasMore.value = detail.hasMore;
      nextCursor.value = detail.nextCursor;
      cacheRecent(id, messages.value);
      mergeConversation(detail.conversation);
    } catch (e) {
      if (token !== openToken) return;
      error.value = errText(e);
      if (!cached?.messages.length) {
        messages.value = [];
        conversationId.value = '';
        conversationTitle.value = '';
      }
    } finally {
      if (token === openToken) loadingMessages.value = false;
    }
  }

  async function refreshSilently(id: string) {
    try {
      const detail = await fetchConversation(id, 30);
      if (conversationId.value !== id) return;
      const previousHasMore = hasMore.value;
      const previousCursor = nextCursor.value;
      const fetched = detail.messages.map(fromStored);
      const fetchedIds = new Set(
        fetched.map((m) => m.message_id).filter((value): value is string => Boolean(value)),
      );
      const oldestFetched = fetched[0]?.created_at ?? Number.POSITIVE_INFINITY;
      const older = messages.value.filter(
        (m) =>
          m.message_id &&
          !fetchedIds.has(m.message_id) &&
          (m.created_at ?? 0) < oldestFetched,
      );
      conversationTitle.value = detail.conversation.title;
      if (older.length > 0) {
        messages.value = [...older, ...fetched];
        hasMore.value = previousHasMore;
        nextCursor.value = previousCursor;
      } else {
        messages.value = fetched;
        hasMore.value = detail.hasMore;
        nextCursor.value = detail.nextCursor;
      }
      cacheRecent(id, messages.value);
      mergeConversation(detail.conversation);
    } catch {
      // 保留本地消息，列表刷新会给出最终状态
    }
  }

  async function send(text: string, reasoning?: 'low' | 'medium' | 'high') {
    const message = text.trim();
    if (!message || streaming.value) return;
    error.value = '';
    messages.value.push({ role: 'user', content: message, created_at: Date.now() });
    const reply: ChatMessage = { role: 'assistant', content: '', created_at: Date.now() };
    messages.value.push(reply);
    streaming.value = true;
    controller = new AbortController();
    let activeConversation = conversationId.value;
    try {
      await streamChatIn(
        conversationId.value || null,
        message,
        (event) => {
          if (event.type === 'conversation' && event.conversation_id) {
            activeConversation = event.conversation_id;
            if (!conversationId.value) {
              conversationId.value = event.conversation_id;
              conversationTitle.value = event.title ?? '';
            }
          }
          if (event.type === 'delta' && event.text) reply.content += event.text;
          if (event.type === 'citations' && event.citations) {
            reply.citations = [...(reply.citations ?? []), ...event.citations];
          }
          if (event.type === 'route' && event.agent_name) reply.agent = event.agent_name;
          if (event.type === 'error') error.value = event.message ?? '对话出错';
        },
        controller.signal,
        reasoning,
      );
      if (!reply.content && !error.value) error.value = '未收到回复';
    } catch (e) {
      if (!controller.signal.aborted) error.value = errText(e);
    } finally {
      streaming.value = false;
      controller = null;
      if (!reply.content) {
        const index = messages.value.indexOf(reply);
        if (index >= 0) messages.value.splice(index, 1);
      }
      if (activeConversation) {
        await refreshSilently(activeConversation);
        await loadConversations(search.value);
      }
    }
  }

  function stop() {
    controller?.abort();
  }

  function reset() {
    stop();
    messages.value = [];
    conversationId.value = '';
    conversationTitle.value = '';
    error.value = '';
    hasMore.value = false;
    nextCursor.value = null;
    loadingMessages.value = false;
    loadingOlder.value = false;
  }

  async function loadOlder() {
    const id = conversationId.value;
    const cursor = nextCursor.value;
    if (!id || !cursor || loadingOlder.value) return;
    loadingOlder.value = true;
    try {
      const page = await fetchConversation(id, 30, cursor);
      if (conversationId.value !== id) return;
      const existing = new Set(
        messages.value.map((m) => m.message_id).filter((value): value is string => Boolean(value)),
      );
      const older = page.messages
        .map(fromStored)
        .filter((m) => !m.message_id || !existing.has(m.message_id));
      messages.value = [...older, ...messages.value];
      hasMore.value = page.hasMore;
      nextCursor.value = page.nextCursor;
      cacheRecent(id, messages.value);
    } catch (e) {
      error.value = errText(e);
    } finally {
      loadingOlder.value = false;
    }
  }

  async function rename(id: string, title: string) {
    const updated = await apiUpdateConversation(id, { title });
    mergeConversation(updated);
    if (conversationId.value === id) conversationTitle.value = updated.title;
  }

  async function togglePin(id: string) {
    const item = conversations.value.find((c) => c.conversation_id === id);
    if (!item) return;
    const updated = await apiUpdateConversation(id, { pinned: !item.pinned });
    mergeConversation(updated);
  }

  async function remove(id: string) {
    await apiDeleteConversation(id);
    conversations.value = conversations.value.filter((c) => c.conversation_id !== id);
    total.value = Math.max(0, total.value - 1);
    writeJson(LIST_CACHE_KEY, conversations.value);
    const cache = readRecent();
    delete cache[id];
    writeRecent(cache);
    if (conversationId.value === id) reset();
  }

  return {
    messages,
    conversations,
    conversationId,
    conversationTitle,
    search,
    loadingList,
    loadingMessages,
    loadingOlder,
    hasMore,
    nextCursor,
    total,
    streaming,
    error,
    listError,
    hydrate,
    loadConversations,
    open,
    send,
    stop,
    reset,
    loadOlder,
    rename,
    togglePin,
    remove,
  };
});
