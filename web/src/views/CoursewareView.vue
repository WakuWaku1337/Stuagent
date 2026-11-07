<script setup lang="ts">
import { onMounted, ref } from 'vue';

interface Item {
  courseware_id: string;
  title: string;
  topic: string;
  subject: string | null;
  source: string;
  created_at: number;
}

const items = ref<Item[]>([]);
const topic = ref('勾股定理');
const subject = ref('数学');
const current = ref<Item | null>(null);
const loading = ref(false);
const message = ref('');

async function load() {
  const res = await fetch('/api/courseware');
  const data = await res.json();
  items.value = data.items ?? [];
}

async function generate() {
  loading.value = true;
  message.value = '';
  try {
    const res = await fetch('/api/courseware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic.value, subject: subject.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? '生成失败');
    message.value = `已生成《${data.title}》（${data.source === 'llm' ? '模型生成' : '内置模板'}）`;
    await load();
    current.value = items.value.find((i) => i.courseware_id === data.courseware_id) ?? null;
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function remove(item: Item) {
  await fetch(`/api/courseware/${item.courseware_id}`, { method: 'DELETE' });
  if (current.value?.courseware_id === item.courseware_id) current.value = null;
  await load();
}

onMounted(async () => {
  await load();
  const open = new URLSearchParams(location.search).get('open');
  if (open) current.value = items.value.find((i) => i.courseware_id === open) ?? items.value[0] ?? null;
});
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>交互课件</h2>
      <router-link to="/chat" class="back">对话 →</router-link>
    </header>

    <section class="panel">
      <label>主题 <input v-model="topic" /></label>
      <label>学科 <input v-model="subject" class="short" /></label>
      <button class="primary" :disabled="loading" @click="generate">{{ loading ? '生成中…' : '生成课件' }}</button>
      <p v-if="message" class="msg">{{ message }}</p>
      <p class="hint">生成单文件 HTML（canvas 交互 + 滑块），离线可用，在沙箱 iframe 中预览。</p>
    </section>

    <section class="panel">
      <h3>课件列表</h3>
      <ul class="list">
        <li v-for="i in items" :key="i.courseware_id" :class="{ active: current?.courseware_id === i.courseware_id }">
          <span class="title" @click="current = i">{{ i.title }}</span>
          <span class="tag">{{ i.source === 'llm' ? '模型' : '模板' }}</span>
          <button class="ghost" @click="remove(i)">删除</button>
        </li>
        <li v-if="items.length === 0" class="empty">还没有课件</li>
      </ul>
    </section>

    <section v-if="current" class="panel">
      <h3>{{ current.title }}</h3>
      <iframe
        :src="`/api/courseware/${current.courseware_id}`"
        class="frame"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
      ></iframe>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 1000px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
label { margin-right: 14px; }
input { border: 1px solid #d1d5db; border-radius: 6px; padding: 5px 8px; font: inherit; width: 220px; }
input.short { width: 100px; }
button { border: none; border-radius: 8px; padding: 7px 14px; font: inherit; cursor: pointer; }
.primary { background: #2563eb; color: #fff; }
.primary:disabled { background: #93c5fd; }
.ghost { background: #f3f4f6; padding: 4px 10px; }
.hint, .msg { color: #6b7280; font-size: 13px; }
.msg { color: #b45309; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { display: flex; align-items: center; gap: 12px; padding: 9px 6px; border-bottom: 1px solid #f0f1f3; }
.list li.active { background: #eff6ff; }
.title { flex: 1; cursor: pointer; color: #1f2937; }
.tag { font-size: 12px; background: #f3f4f6; border-radius: 999px; padding: 2px 8px; color: #374151; }
.empty { color: #6b7280; justify-content: center; }
.frame { width: 100%; height: 620px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; }
</style>