import { defineStore } from 'pinia';
import { ref } from 'vue';
import { streamChat } from '../api/chat';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const streaming = ref(false);
  const error = ref('');
  const sessionId = ref(`web-${Date.now()}`);
  let controller: AbortController | null = null;

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming.value) return;
    error.value = '';
    messages.value.push({ role: 'user', content: message });
    const reply: ChatMessage = { role: 'assistant', content: '' };
    messages.value.push(reply);
    streaming.value = true;
    controller = new AbortController();
    try {
      await streamChat(
        message,
        sessionId.value,
        (event) => {
          if (event.type === 'delta' && event.text) reply.content += event.text;
          if (event.type === 'error') error.value = event.message ?? '对话出错';
        },
        controller.signal,
      );
      if (!reply.content && !error.value) error.value = '未收到回复';
    } catch (e) {
      if (!controller.signal.aborted) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      streaming.value = false;
      controller = null;
    }
  }

  function stop() {
    controller?.abort();
  }

  function reset() {
    stop();
    messages.value = [];
    error.value = '';
    sessionId.value = `web-${Date.now()}`;
  }

  return { messages, streaming, error, sessionId, send, stop, reset };
});