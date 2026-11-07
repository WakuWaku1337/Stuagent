<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useChatStore } from '../stores/chat';
import MarkdownView from '../components/MarkdownView.vue';

const chat = useChatStore();
const input = ref('');
const listEl = ref<HTMLElement>();

async function send() {
  const text = input.value;
  if (!text.trim() || chat.streaming) return;
  input.value = '';
  await chat.send(text);
}

watch(
  () => chat.messages.map((m) => m.content).join('\u0000'),
  () =>
    nextTick(() => {
      listEl.value?.scrollTo({ top: listEl.value.scrollHeight });
    }),
);
</script>

<template>
  <div class="chat-page">
    <header class="chat-header">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>智学对话</h2>
      <button class="ghost" @click="chat.reset()">新会话</button>
    </header>

    <div ref="listEl" class="message-list">
      <div v-if="chat.messages.length === 0" class="empty">
        你好，我是智学主讲老师。遇到难题先别急着要答案，说说你卡在哪一步？
      </div>
      <div
        v-for="(m, i) in chat.messages"
        :key="i"
        class="bubble-row"
        :class="m.role"
      >
        <div class="bubble" :class="m.role">
          <div v-if="m.role === 'assistant'" class="agent-badge">{{ m.agent ?? '智学' }}</div>
          <MarkdownView v-if="m.role === 'assistant'" :text="m.content || '…'" />
          <template v-else>{{ m.content }}</template>
          <div v-if="m.citations?.length" class="citations">
            <div v-for="c in m.citations" :key="c.chunk_id" class="citation">
              <span class="cite-idx">[{{ c.index }}]</span>
              <span class="cite-src">
                《{{ c.source_name }}》{{ c.chapter ? ` · ${c.chapter}` : '' }}{{ c.page ? ` · 第${c.page}页` : '' }}
              </span>
              <div class="cite-snippet">{{ c.snippet }}</div>
            </div>
          </div>
        </div>
      </div>
      <p v-if="chat.error" class="error">{{ chat.error }}</p>
    </div>

    <footer class="input-bar">
      <textarea
        v-model="input"
        rows="2"
        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button v-if="!chat.streaming" class="primary" :disabled="!input.trim()" @click="send">
        发送
      </button>
      <button v-else class="ghost" @click="chat.stop()">停止</button>
    </footer>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 860px;
  margin: 0 auto;
  background: #fff;
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid #e5e7eb;
}
.chat-header h2 {
  flex: 1;
  margin: 0;
  font-size: 18px;
}
.back {
  color: #2563eb;
  text-decoration: none;
}
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.empty {
  color: #6b7280;
  text-align: center;
  margin-top: 40px;
}
.bubble-row {
  display: flex;
  margin-bottom: 14px;
}
.bubble-row.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.bubble.user {
  background: #2563eb;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.bubble.assistant {
  background: #f3f4f6;
  border-bottom-left-radius: 4px;
  white-space: normal;
}
.error {
  color: #dc2626;
  text-align: center;
}
.agent-badge {
  display: inline-block;
  font-size: 11px;
  color: #2563eb;
  background: #eff6ff;
  border-radius: 999px;
  padding: 1px 8px;
  margin-bottom: 6px;
}
.citations {
  margin-top: 10px;
  border-top: 1px dashed #d1d5db;
  padding-top: 8px;
  font-size: 13px;
}
.citation {
  margin-bottom: 6px;
}
.cite-idx {
  color: #2563eb;
  font-weight: 600;
  margin-right: 4px;
}
.cite-src {
  color: #374151;
}
.cite-snippet {
  color: #6b7280;
  margin-top: 2px;
}
.input-bar {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #e5e7eb;
}
.input-bar textarea {
  flex: 1;
  resize: none;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
}
button {
  border: none;
  border-radius: 8px;
  padding: 8px 18px;
  font: inherit;
  cursor: pointer;
}
button.primary {
  background: #2563eb;
  color: #fff;
}
button.primary:disabled {
  background: #93c5fd;
  cursor: default;
}
button.ghost {
  background: #f3f4f6;
  color: #374151;
}
</style>