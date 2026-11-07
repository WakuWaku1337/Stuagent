<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

interface Snapshot {
  content: string;
  options?: Record<string, string>;
  answer?: string;
  explanation?: string | null;
  knowledge_point?: string;
}
interface RecordItem {
  record_id: string;
  question_snapshot: Snapshot;
  student_answer: string | null;
  reason: string | null;
  review_count: number;
  interval_days: number;
  next_review: number;
}

const records = ref<RecordItem[]>([]);
const dueOnly = ref(false);
const due = ref(0);
const message = ref('');

const visible = computed(() => (dueOnly.value ? records.value.filter((r) => r.next_review <= Date.now()) : records.value));

async function load() {
  const res = await fetch('/api/wrongbook');
  const data = await res.json();
  records.value = data.records ?? [];
  due.value = data.due ?? 0;
}

async function review(r: RecordItem, quality: number) {
  const res = await fetch(`/api/wrongbook/${r.record_id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quality }),
  });
  const data = await res.json();
  if (!res.ok) {
    message.value = data.error ?? '操作失败';
    return;
  }
  message.value = quality >= 3 ? `已记录复习，${data.interval_days} 天后再见` : '已放入短期复习，明天再练';
  await load();
}

async function remove(r: RecordItem) {
  await fetch(`/api/wrongbook/${r.record_id}`, { method: 'DELETE' });
  await load();
}

onMounted(load);

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN');
}
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>错题本</h2>
      <router-link to="/quiz" class="back">去练习 →</router-link>
    </header>

    <section class="panel toolbar">
      <span class="due">今日待复习 <strong>{{ due }}</strong> 题</span>
      <label><input v-model="dueOnly" type="checkbox" /> 只看待复习</label>
      <span v-if="message" class="msg">{{ message }}</span>
    </section>

    <section v-for="r in visible" :key="r.record_id" class="panel">
      <p class="stem">{{ r.question_snapshot.content }}</p>
      <p class="meta">
        {{ r.question_snapshot.knowledge_point ?? '未标注' }} · 错因：{{ r.reason ?? '-' }} · 已复习 {{ r.review_count }} 次
      </p>
      <div v-if="r.question_snapshot.options" class="options">
        <span v-for="(text, key) in r.question_snapshot.options" :key="key" :class="{ correct: key === r.question_snapshot.answer }">
          {{ key }}. {{ text }}
        </span>
      </div>
      <p class="answer">
        正确答案：{{ r.question_snapshot.answer ?? '-' }}
        <span v-if="r.student_answer"> · 我的答案：{{ r.student_answer }}</span>
        · 下次复习：{{ fmtDate(r.next_review) }}
      </p>
      <p v-if="r.question_snapshot.explanation" class="explain">{{ r.question_snapshot.explanation }}</p>
      <div class="ops">
        <button class="ok" @click="review(r, 5)">记住了</button>
        <button class="warn" @click="review(r, 2)">还不会</button>
        <button class="ghost" @click="remove(r)">移除</button>
      </div>
    </section>
    <p v-if="visible.length === 0" class="empty">暂无错题。答错的题会自动收录。</p>
  </main>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
.toolbar { display: flex; align-items: center; gap: 20px; }
.due { color: #b45309; }
.msg { color: #15803d; }
.stem { font-size: 15px; line-height: 1.7; margin: 0 0 6px; }
.meta, .answer { color: #6b7280; font-size: 13px; margin: 4px 0; }
.options { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0; font-size: 14px; }
.options .correct { color: #15803d; font-weight: 600; }
.explain { color: #374151; font-size: 14px; background: #f9fafb; padding: 8px 10px; border-radius: 6px; }
.ops { display: flex; gap: 10px; margin-top: 10px; }
button { border: none; border-radius: 8px; padding: 7px 14px; font: inherit; cursor: pointer; }
.ok { background: #dcfce7; color: #15803d; }
.warn { background: #fef3c7; color: #92400e; }
.ghost { background: #f3f4f6; }
.empty { text-align: center; color: #6b7280; }
</style>