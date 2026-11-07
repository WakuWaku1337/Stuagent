<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Clock, Promotion, Refresh, VideoPause } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useChatStore } from '../stores/chat';
import MarkdownView from '../components/MarkdownView.vue';
import ChatHistory from '../components/ChatHistory.vue';
import type { ConversationItem } from '../api/conversations';

const chat = useChatStore();
const route = useRoute();
const router = useRouter();
const input = ref('');
const reasoning = ref<'default' | 'low' | 'medium' | 'high'>('default');
const listEl = ref<HTMLElement>();
const inputRef = ref<{ focus: () => void }>();
const historyOpen = ref(false);
const renameVisible = ref(false);
const renameTarget = ref<ConversationItem | null>(null);
const renameInput = ref('');

const prompts = [
  '用勾股定理帮我讲一道综合题',
  '总结我最近的薄弱知识点',
  '把「一元二次方程」讲得更直观',
];

const lastAgent = computed(() => {
  const assistant = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.agent);
  return assistant?.agent ?? '';
});

const stateText = computed(() => {
  if (chat.streaming) return '正在作答…';
  if (chat.conversationTitle) return `当前会话 · ${chat.conversationTitle}`;
  return '在线 · 回答附带教材引用';
});

let stickToBottom = true;

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  nextTick(() => {
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior });
  });
}

function onThreadScroll() {
  const el = listEl.value;
  if (!el) return;
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

async function send() {
  const text = input.value;
  if (!text.trim() || chat.streaming) return;
  input.value = '';
  stickToBottom = true;
  await chat.send(text, reasoning.value === 'default' ? undefined : reasoning.value);
}

function usePrompt(prompt: string) {
  input.value = prompt;
  nextTick(() => inputRef.value?.focus());
}

async function selectConversation(id: string) {
  historyOpen.value = false;
  if (!id || id === chat.conversationId || chat.streaming) return;
  stickToBottom = true;
  await chat.open(id);
  scrollToBottom('auto');
}

function newChat() {
  if (chat.streaming) chat.stop();
  chat.reset();
  historyOpen.value = false;
  stickToBottom = true;
  nextTick(() => inputRef.value?.focus());
}

async function loadOlder() {
  const el = listEl.value;
  const previousHeight = el?.scrollHeight ?? 0;
  const previousTop = el?.scrollTop ?? 0;
  await chat.loadOlder();
  await nextTick();
  if (el) el.scrollTop = previousTop + (el.scrollHeight - previousHeight);
}

function openRename(item: ConversationItem) {
  renameTarget.value = item;
  renameInput.value = item.title;
  renameVisible.value = true;
}

async function submitRename() {
  const target = renameTarget.value;
  const title = renameInput.value.trim();
  if (!target) return;
  if (!title) {
    ElMessage.warning('标题不能为空');
    return;
  }
  try {
    await chat.rename(target.conversation_id, title);
    renameVisible.value = false;
    ElMessage.success('已重命名');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '重命名失败');
  }
}

async function togglePin(item: ConversationItem) {
  try {
    await chat.togglePin(item.conversation_id);
    ElMessage.success(item.pinned ? '已取消置顶' : '已置顶');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function removeConversation(item: ConversationItem) {
  try {
    await ElMessageBox.confirm(
      `将删除「${item.title}」及其全部消息，且无法恢复。`,
      '删除会话',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }
  try {
    await chat.remove(item.conversation_id);
    ElMessage.success('已删除');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

watch(
  () => [chat.messages.length, chat.messages[chat.messages.length - 1]?.content ?? '', chat.error] as const,
  () => {
    if (!stickToBottom) return;
    scrollToBottom(chat.streaming ? 'auto' : 'smooth');
  },
);

watch(
  () => chat.conversationId,
  (id) => {
    const current = typeof route.query.c === 'string' ? route.query.c : '';
    if (id && current !== id) {
      void router.replace({ query: { ...route.query, c: id } });
    } else if (!id && current) {
      const query = { ...route.query };
      delete query.c;
      void router.replace({ query });
    }
  },
);

watch(
  () => route.query.c,
  (value) => {
    const id = typeof value === 'string' ? value : '';
    if (!id) {
      if (chat.conversationId && !chat.streaming) chat.reset();
      return;
    }
    if (id !== chat.conversationId && !chat.streaming) void selectConversation(id);
  },
);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => chat.search,
  (value) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void chat.loadConversations(value), 250);
  },
);

onMounted(async () => {
  chat.hydrate();
  const id = typeof route.query.c === 'string' ? route.query.c : '';
  await chat.loadConversations(chat.search);
  if (id) {
    stickToBottom = true;
    await chat.open(id);
    scrollToBottom('auto');
  }
});
</script>

<template>
  <div class="chat-page">
    <aside class="history-pane">
      <ChatHistory
        v-model:search="chat.search"
        :conversations="chat.conversations"
        :current-id="chat.conversationId"
        :loading="chat.loadingList"
        :error="chat.listError"
        :streaming="chat.streaming"
        @create="newChat"
        @select="selectConversation"
        @rename="openRename"
        @pin="togglePin"
        @remove="removeConversation"
      />
    </aside>

    <section class="chat-main">
    <div class="chat-bar">
      <div class="chat-who">
        <el-button
          class="history-toggle"
          text
          circle
          :icon="Clock"
          aria-label="打开历史会话"
          title="历史会话"
          @click="historyOpen = true"
        />
        <span class="agent-avatar">智</span>
        <div class="chat-who-text">
          <p class="chat-name">智学主讲</p>
          <p class="chat-state" :title="stateText">{{ stateText }}</p>
        </div>
      </div>
      <div class="chat-actions">
        <el-tag v-if="lastAgent" size="small" effect="plain" class="agent-tag">{{ lastAgent }}</el-tag>
        <el-select v-model="reasoning" size="small" class="reasoning-select" aria-label="单次思考强度">
          <el-option label="默认推理" value="default" />
          <el-option label="低" value="low" />
          <el-option label="中" value="medium" />
          <el-option label="高" value="high" />
        </el-select>
        <el-button text :icon="Refresh" :disabled="chat.streaming" @click="newChat">新会话</el-button>
      </div>
    </div>

    <div ref="listEl" class="thread" @scroll.passive="onThreadScroll">
      <div class="thread-inner">
        <div v-if="chat.loadingOlder || chat.hasMore" class="older-row">
          <el-button text size="small" :loading="chat.loadingOlder" @click="loadOlder">
            加载更早的消息
          </el-button>
        </div>

        <div v-if="chat.loadingMessages && chat.messages.length === 0" class="thread-loading">
          正在加载会话…
        </div>

        <div v-else-if="chat.messages.length === 0" class="chat-empty">
          <p class="chat-empty-kicker">主讲老师</p>
          <h2 class="chat-empty-title">先说清楚卡在哪一步。</h2>
          <p class="chat-empty-desc">
            可以直接问概念、贴题目，或让我基于资料库讲解。回答会标注引用来源，便于回查原文。
          </p>
          <div class="prompt-grid">
            <button
              v-for="prompt in prompts"
              :key="prompt"
              class="prompt-chip"
              @click="usePrompt(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>

        <div v-for="(m, i) in chat.messages" :key="m.message_id ?? `local-${i}`" class="msg-row" :class="m.role">
          <span v-if="m.role === 'assistant'" class="agent-avatar small">智</span>
          <div class="bubble" :class="m.role">
            <div v-if="m.role === 'assistant'" class="bubble-top">
              <el-tag size="small" effect="plain">{{ m.agent ?? '智学主讲' }}</el-tag>
            </div>
            <MarkdownView v-if="m.role === 'assistant'" :text="m.content || ' '" />
            <p v-else class="user-text">{{ m.content }}</p>

            <span
              v-if="chat.streaming && m.role === 'assistant' && !m.content"
              class="typing"
              aria-label="正在输入"
            >
              <i /><i /><i />
            </span>

            <div v-if="m.citations?.length" class="citations">
              <p class="cite-label">参考教材</p>
              <div v-for="c in m.citations" :key="c.chunk_id" class="cite">
                <div class="cite-head">
                  <span class="cite-index numeric">[{{ c.index }}]</span>
                  <span class="cite-source">《{{ c.source_name }}》</span>
                  <span class="cite-meta">
                    {{ c.chapter || '未分章' }}<template v-if="c.page"> · 第 {{ c.page }} 页</template>
                  </span>
                  <span v-if="c.score" class="cite-score numeric">
                    {{ Math.min(100, Math.round(c.score * 100)) }}%
                  </span>
                </div>
                <p class="cite-snippet">{{ c.snippet }}</p>
              </div>
            </div>
          </div>
        </div>

        <el-alert
          v-if="chat.error"
          class="chat-error"
          :title="chat.error"
          type="error"
          :closable="false"
          show-icon
        />
      </div>
    </div>

    <div class="composer-wrap">
      <div class="composer">
        <el-input
          ref="inputRef"
          v-model="input"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 5 }"
          resize="none"
          placeholder="输入问题，Enter 发送，Shift + Enter 换行"
          @keydown.enter.exact.prevent="send"
        />
        <el-button
          v-if="!chat.streaming"
          type="primary"
          :icon="Promotion"
          :disabled="!input.trim()"
          @click="send"
        >
          发送
        </el-button>
        <el-button v-else :icon="VideoPause" @click="chat.stop()">停止</el-button>
      </div>
      <p class="composer-hint">Enter 发送 · Shift + Enter 换行 · 会话与引用保存在本机</p>
    </div>
    </section>

    <el-drawer
      v-model="historyOpen"
      direction="ltr"
      size="288px"
      :with-header="false"
      class="chat-history-drawer"
    >
      <ChatHistory
        v-model:search="chat.search"
        :conversations="chat.conversations"
        :current-id="chat.conversationId"
        :loading="chat.loadingList"
        :error="chat.listError"
        :streaming="chat.streaming"
        @create="newChat"
        @select="selectConversation"
        @rename="openRename"
        @pin="togglePin"
        @remove="removeConversation"
      />
    </el-drawer>

    <el-dialog v-model="renameVisible" title="重命名会话" width="420px" @closed="renameTarget = null">
      <el-input
        v-model="renameInput"
        maxlength="60"
        show-word-limit
        placeholder="输入会话标题"
        @keyup.enter="submitRename"
      />
      <template #footer>
        <el-button @click="renameVisible = false">取消</el-button>
        <el-button type="primary" @click="submitRename">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.chat-page {
  height: 100%;
  display: flex;
  flex-direction: row;
  background: #f6f8f7;
}

.history-pane {
  display: none;
  flex: 0 0 272px;
  width: 272px;
  min-height: 0;
  background: #fff;
  border-right: 1px solid var(--line);
}

.chat-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 28px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.chat-who {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.chat-who-text {
  min-width: 0;
}

.history-toggle {
  display: inline-flex;
  margin-right: 2px;
  color: var(--muted);
}

.agent-avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--ink);
  color: #fff;
  font-family: var(--font-serif);
  font-size: 15px;
  flex: none;
}

.agent-avatar.small {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 2px;
}

.chat-name {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
}

.chat-state {
  max-width: min(520px, 48vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--muted);
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.reasoning-select {
  width: 104px;
}

.reasoning-select :deep(.el-select__wrapper) {
  min-height: 28px;
  font-size: 12px;
}

.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.thread-inner {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  padding: 28px 28px 12px;
}

.older-row {
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
}

.older-row :deep(.el-button) {
  font-size: 12px;
  color: var(--muted);
}

.thread-loading {
  padding: 40px 8px;
  font-size: 13px;
  color: var(--faint);
}

.chat-empty {
  padding: 44px 8px 30px;
  max-width: 640px;
}

.chat-empty-kicker {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--faint);
}

.chat-empty-title {
  margin-top: 8px;
  font-family: var(--font-serif);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.chat-empty-desc {
  margin-top: 10px;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--muted);
}

.prompt-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 22px;
}

.prompt-chip {
  text-align: left;
  padding: 11px 14px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  color: var(--ink-soft);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.prompt-chip:hover {
  border-color: var(--line-strong);
  background: #fcfdfc;
}

.msg-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 18px;
}

.msg-row.user {
  justify-content: flex-end;
}

.bubble {
  max-width: min(76%, 700px);
  padding: 13px 16px;
  border-radius: 14px;
  line-height: 1.7;
}

.bubble.assistant {
  background: #fff;
  border: 1px solid var(--line);
  border-top-left-radius: 5px;
}

.bubble.user {
  background: var(--ink);
  color: #f3f6f4;
  border-top-right-radius: 5px;
}

.bubble-top {
  margin-bottom: 7px;
}

.user-text {
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bubble.assistant :deep(.markdown) {
  font-size: 14px;
}

.citations {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.cite-label {
  font-size: 11.5px;
  color: var(--faint);
  margin-bottom: 8px;
}

.cite {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f9fbfa;
  margin-bottom: 7px;
}

.cite:last-child {
  margin-bottom: 0;
}

.cite-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
}

.cite-index {
  color: var(--accent);
  font-weight: 600;
}

.cite-source {
  color: var(--ink);
}

.cite-meta {
  color: var(--faint);
}

.cite-score {
  margin-left: auto;
  color: var(--faint);
  font-size: 11px;
}

.cite-snippet {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--muted);
}

.typing {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}

.typing i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--faint);
  animation: blink 1.2s infinite ease-in-out;
}

.typing i:nth-child(2) {
  animation-delay: 0.15s;
}

.typing i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}

.chat-error {
  margin-top: 8px;
}

.composer-wrap {
  flex: 0 0 auto;
  padding: 10px 28px 18px;
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  padding: 9px 10px 9px 14px;
  background: #fff;
  border: 1px solid var(--line-strong);
  border-radius: 13px;
  box-shadow: 0 6px 18px rgba(21, 32, 43, 0.05);
}

.composer :deep(.el-textarea__inner) {
  box-shadow: none;
  padding: 6px 2px;
  background: transparent;
  font-size: 14px;
  line-height: 1.65;
}

.composer :deep(.el-textarea__inner:focus) {
  box-shadow: none;
}

.composer :deep(.el-button) {
  flex: none;
  height: 34px;
}

.composer-hint {
  max-width: 920px;
  margin: 8px auto 0;
  text-align: center;
  font-size: 11px;
  color: var(--faint);
}

@media (min-width: 1180px) {
  .history-pane {
    display: flex;
    flex-direction: column;
  }

  .history-toggle {
    display: none;
  }
}

@media (max-width: 900px) {
  .chat-bar {
    padding: 10px 16px;
    flex-wrap: wrap;
  }

  .agent-tag {
    display: none;
  }

  .chat-state {
    max-width: 46vw;
  }

  .thread-inner {
    padding: 20px 16px 8px;
  }

  .bubble {
    max-width: 86%;
  }

  .composer-wrap {
    padding: 8px 12px 14px;
  }

  .chat-empty-title {
    font-size: 24px;
  }
}
</style>

<style>
.chat-history-drawer .el-drawer__body {
  padding: 0;
  background: #fff;
}
</style>