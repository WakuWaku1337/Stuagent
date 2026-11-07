<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

interface Question {
  question_id: string;
  knowledge_point: string;
  difficulty: string;
  content: string;
  options: Record<string, string>;
}
interface ResultItem {
  question_id: string;
  is_correct: boolean;
  correct_answer: string;
  student_answer: string;
  explanation: string | null;
  mastery: number;
}

const count = ref(5);
const duration = ref(10);
const sessionId = ref('');
const questions = ref<Question[]>([]);
const answers = ref<Record<string, string>>({});
const results = ref<ResultItem[]>([]);
const analysis = ref<{ knowledge_point: string; wrong: number; total: number }[]>([]);
const score = ref<number | null>(null);
const remaining = ref(0);
const loading = ref(false);
const message = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const answeredCount = computed(() => Object.values(answers.value).filter(Boolean).length);

function startTimer(minutes: number) {
  remaining.value = minutes * 60;
  timer = setInterval(() => {
    remaining.value -= 1;
    if (remaining.value <= 0) {
      clearInterval(timer!);
      timer = null;
      submit();
    }
  }, 1000);
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function start() {
  loading.value = true;
  message.value = '';
  results.value = [];
  analysis.value = [];
  score.value = null;
  answers.value = {};
  try {
    const res = await fetch('/api/exam/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: count.value, duration_min: duration.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '开始失败');
    sessionId.value = data.session_id;
    questions.value = data.questions;
    startTimer(data.duration_min);
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const payload = questions.value.map((q) => ({
    question_id: q.question_id,
    answer: answers.value[q.question_id] ?? '',
  }));
  const res = await fetch(`/api/exam/${sessionId.value}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    message.value = data.error ?? '交卷失败';
    return;
  }
  score.value = data.score;
  results.value = data.results;
  analysis.value = data.analysis ?? [];
  questions.value = [];
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>模拟考试</h2>
      <router-link to="/mastery" class="back">掌握度 →</router-link>
    </header>

    <section v-if="questions.length === 0 && score === null" class="panel setup">
      <label>题量 <input v-model.number="count" type="number" min="1" max="30" /></label>
      <label>时长（分钟） <input v-model.number="duration" type="number" min="1" max="120" /></label>
      <button class="primary" :disabled="loading" @click="start">{{ loading ? '正在组卷…' : '开始考试' }}</button>
      <p v-if="message" class="msg">{{ message }}</p>
    </section>

    <template v-if="questions.length > 0">
      <section class="panel sticky">
        <span class="timer">剩余 {{ fmt(remaining) }}</span>
        <span class="progress">已答 {{ answeredCount }} / {{ questions.length }}</span>
        <button class="primary" @click="submit">交卷</button>
      </section>
      <section v-for="(q, i) in questions" :key="q.question_id" class="panel">
        <p class="stem">{{ i + 1 }}. {{ q.content }}</p>
        <p class="meta">{{ q.knowledge_point }} · {{ q.difficulty }}</p>
        <label v-for="(text, key) in q.options" :key="key" class="option">
          <input v-model="answers[q.question_id]" type="radio" :value="key" />
          <span>{{ key }}. {{ text }}</span>
        </label>
      </section>
    </template>

    <template v-if="score !== null">
      <section class="panel result">
        <h3>得分 {{ score }} 分</h3>
        <p v-if="analysis.length">
          失分分布：
          <span v-for="a in analysis" :key="a.knowledge_point" class="tag">{{ a.knowledge_point }} 错 {{ a.wrong }}/{{ a.total }}</span>
        </p>
      </section>
      <section v-for="(r, i) in results" :key="r.question_id" class="panel" :class="{ wrong: !r.is_correct }">
        <p class="stem">第 {{ i + 1 }} 题：{{ r.is_correct ? '正确' : '错误' }}</p>
        <p class="meta">
          我的答案 {{ r.student_answer || '未答' }} · 正确答案 {{ r.correct_answer }} ·
          知识点掌握度 {{ (r.mastery * 100).toFixed(1) }}%
        </p>
        <p v-if="r.explanation" class="explain">{{ r.explanation }}</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
.setup label { margin-right: 18px; }
input[type='number'] { width: 70px; border: 1px solid #d1d5db; border-radius: 6px; padding: 5px 8px; font: inherit; }
button { border: none; border-radius: 8px; padding: 8px 16px; font: inherit; cursor: pointer; }
.primary { background: #2563eb; color: #fff; }
.primary:disabled { background: #93c5fd; }
.sticky { position: sticky; top: 10px; z-index: 2; display: flex; align-items: center; gap: 20px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); }
.timer { font-weight: 600; color: #b45309; font-variant-numeric: tabular-nums; }
.progress { flex: 1; color: #6b7280; }
.stem { font-size: 15px; line-height: 1.7; margin: 0 0 6px; }
.meta { color: #6b7280; font-size: 13px; margin: 4px 0; }
.option { display: block; margin: 6px 0; cursor: pointer; }
.result h3 { margin: 0 0 8px; color: #15803d; }
.tag { display: inline-block; margin-left: 8px; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.wrong { border-left: 3px solid #dc2626; }
.explain { color: #374151; font-size: 14px; background: #f9fafb; padding: 8px 10px; border-radius: 6px; }
.msg { color: #b45309; }
</style>