<script setup lang="ts">
import { ref } from 'vue';

interface Question {
  question_id: string;
  knowledge_point: string;
  difficulty: string;
  content: string;
  options: Record<string, string>;
}
interface GradeResult {
  is_correct: boolean;
  correct_answer: string;
  explanation: string | null;
  mastery: number;
}

const knowledgePoint = ref('勾股定理');
const difficulty = ref('基础');
const count = ref(3);
const questions = ref<Question[]>([]);
const sessionId = ref('');
const answers = ref<Record<string, string>>({});
const results = ref<Record<string, GradeResult>>({});
const loading = ref(false);
const message = ref('');

async function generate() {
  loading.value = true;
  message.value = '';
  questions.value = [];
  answers.value = {};
  results.value = {};
  try {
    const res = await fetch('/api/quiz/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledge_point: knowledgePoint.value,
        difficulty: difficulty.value,
        count: count.value,
        subject: '数学',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '生成失败');
    questions.value = data.questions;
    sessionId.value = data.session_id;
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function submitQuestion(q: Question) {
  const answer = answers.value[q.question_id];
  if (!answer) {
    message.value = '请先选择答案';
    return;
  }
  const res = await fetch('/api/quiz/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId.value, question_id: q.question_id, answer }),
  });
  const data = await res.json();
  if (!res.ok) {
    message.value = data.error ?? '提交失败';
    return;
  }
  results.value[q.question_id] = data;
}

function score() {
  const list = Object.values(results.value);
  if (list.length === 0) return null;
  return Math.round((list.filter((r) => r.is_correct).length / list.length) * 100);
}
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>智能出题</h2>
      <router-link to="/wrongbook" class="back">错题本 →</router-link>
    </header>

    <section class="panel">
      <label>知识点 <input v-model="knowledgePoint" /></label>
      <label>
        难度
        <select v-model="difficulty">
          <option>基础</option><option>中等</option><option>拔高</option>
        </select>
      </label>
      <label>题量 <input v-model.number="count" type="number" min="1" max="10" class="num" /></label>
      <button class="primary" :disabled="loading" @click="generate">{{ loading ? '出题中…' : '生成题目' }}</button>
    </section>
    <p v-if="message" class="msg">{{ message }}</p>
    <p v-if="score() !== null" class="score">已答对 {{ score() }}%</p>

    <section v-for="(q, i) in questions" :key="q.question_id" class="panel question">
      <p class="stem">{{ i + 1 }}. {{ q.content }}</p>
      <p class="meta">{{ q.knowledge_point }} · {{ q.difficulty }}</p>
      <label v-for="(text, key) in q.options" :key="key" class="option">
        <input v-model="answers[q.question_id]" type="radio" :value="key" :disabled="!!results[q.question_id]" />
        <span>{{ key }}. {{ text }}</span>
      </label>
      <div v-if="results[q.question_id]" class="feedback" :class="{ ok: results[q.question_id].is_correct }">
        <strong>{{ results[q.question_id].is_correct ? '回答正确' : `回答错误，正确答案 ${results[q.question_id].correct_answer}` }}</strong>
        <span class="mastery">掌握度 {{ (results[q.question_id].mastery * 100).toFixed(1) }}%</span>
        <p v-if="results[q.question_id].explanation">{{ results[q.question_id].explanation }}</p>
      </div>
      <button v-else class="ghost" @click="submitQuestion(q)">提交本题</button>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
.panel label { margin-right: 16px; }
input, select { border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px; font: inherit; }
.num { width: 64px; }
button { border: none; border-radius: 8px; padding: 8px 16px; font: inherit; cursor: pointer; }
.primary { background: #2563eb; color: #fff; }
.primary:disabled { background: #93c5fd; }
.ghost { background: #f3f4f6; }
.msg { color: #b45309; }
.score { color: #15803d; font-weight: 600; }
.stem { font-size: 15px; line-height: 1.7; margin: 0 0 6px; }
.meta { color: #6b7280; font-size: 12px; margin: 0 0 10px; }
.option { display: block; margin: 6px 0; cursor: pointer; }
.feedback { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: #fee2e2; }
.feedback.ok { background: #dcfce7; }
.mastery { margin-left: 12px; color: #374151; font-size: 13px; }
.feedback p { margin: 6px 0 0; color: #374151; }
</style>