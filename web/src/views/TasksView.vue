<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

interface TaskItem {
  task_id: string;
  type: string;
  status: string;
  payload: string;
  result: string | null;
  error: string | null;
  attempts: number;
  created_at: number;
}

const tasks = ref<TaskItem[]>([]);
const knowledgePoint = ref('一元二次方程');
const count = ref(3);
const connected = ref(false);
const events = ref<string[]>([]);
let ws: WebSocket | null = null;

async function load() {
  const res = await fetch('/api/tasks');
  const data = await res.json();
  tasks.value = data.tasks ?? [];
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    connected.value = true;
    ws?.send('ping');
  };
  ws.onclose = () => {
    connected.value = false;
  };
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      events.value.unshift(`${new Date().toLocaleTimeString('zh-CN')} ${data.type}${data.task ? `：${data.task.type} ${data.task.status}` : ''}`);
      events.value = events.value.slice(0, 20);
      if (data.type === 'task') void load();
    } catch {
      /* ignore */
    }
  };
}

async function createTask() {
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'quiz',
      payload: { knowledge_point: knowledgePoint.value, count: count.value, subject: '数学' },
    }),
  });
  await load();
}

async function cancel(t: TaskItem) {
  await fetch(`/api/tasks/${t.task_id}/cancel`, { method: 'POST' });
  await load();
}

onMounted(async () => {
  await load();
  connect();
});

onBeforeUnmount(() => ws?.close());

function statusText(s: string) {
  return (
    {
      queued: '排队中',
      running: '执行中',
      done: '完成',
      failed: '失败',
      timeout: '超时',
      cancelled: '已取消',
    }[s] ?? s
  );
}
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>后台任务</h2>
      <span class="ws" :class="{ on: connected }">{{ connected ? '实时连接已建立' : '实时连接断开' }}</span>
    </header>

    <section class="panel">
      <label>知识点 <input v-model="knowledgePoint" /></label>
      <label>题量 <input v-model.number="count" type="number" min="1" max="10" class="num" /></label>
      <button class="primary" @click="createTask">后台生成练习</button>
      <span class="hint">提交后立即返回，不阻塞对话；可刷新或重启后继续查看结果。</span>
    </section>

    <section class="panel">
      <table class="task-table">
        <thead>
          <tr><th>类型</th><th>状态</th><th>重试</th><th>创建时间</th><th>结果</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.task_id">
            <td>{{ t.type === 'quiz' ? '出题' : '诊断' }}</td>
            <td><span class="tag" :class="t.status">{{ statusText(t.status) }}</span></td>
            <td>{{ t.attempts }}</td>
            <td>{{ new Date(t.created_at).toLocaleTimeString('zh-CN') }}</td>
            <td class="result">{{ t.error ?? t.result ?? '-' }}</td>
            <td><button v-if="t.status === 'queued'" class="ghost" @click="cancel(t)">取消</button></td>
          </tr>
          <tr v-if="tasks.length === 0"><td colspan="6" class="empty">暂无任务</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3>WebSocket 事件</h3>
      <p v-if="events.length === 0" class="empty">等待事件…</p>
      <ul>
        <li v-for="(e, i) in events" :key="i">{{ e }}</li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 900px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.ws { font-size: 12px; color: #b91c1c; }
.ws.on { color: #15803d; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
label { margin-right: 14px; }
input { border: 1px solid #d1d5db; border-radius: 6px; padding: 5px 8px; font: inherit; }
.num { width: 64px; }
button { border: none; border-radius: 8px; padding: 8px 16px; font: inherit; cursor: pointer; }
.primary { background: #2563eb; color: #fff; }
.ghost { background: #f3f4f6; padding: 4px 10px; }
.hint { margin-left: 12px; color: #6b7280; font-size: 13px; }
.task-table { width: 100%; border-collapse: collapse; }
.task-table th, .task-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f0f1f3; font-size: 13px; }
.result { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6b7280; }
.tag { padding: 2px 8px; border-radius: 999px; background: #f3f4f6; font-size: 12px; }
.tag.done { background: #dcfce7; color: #15803d; }
.tag.running { background: #dbeafe; color: #1d4ed8; }
.tag.failed, .tag.timeout { background: #fee2e2; color: #b91c1c; }
.empty { text-align: center; color: #6b7280; }
h3 { margin: 0 0 8px; font-size: 15px; }
ul { list-style: none; padding: 0; margin: 0; font-size: 13px; color: #374151; }
li { padding: 3px 0; }
</style>