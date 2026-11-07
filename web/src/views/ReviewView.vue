<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import MarkdownView from '../components/MarkdownView.vue';

interface ExamItem {
  exam_id: string;
  name: string;
  subject: string | null;
  exam_date: string | null;
  total_score: number | null;
  my_score: number | null;
  status: string;
  question_count: number;
  reviewed: boolean;
}
interface QuestionItem {
  question_no: number;
  question_type: string | null;
  full_score: number | null;
  got_score: number | null;
  is_correct: number | null;
  student_answer: string | null;
  correct_answer: string | null;
  error_reason: string | null;
  knowledge_point: string | null;
  content: string | null;
}
interface Stats {
  rate: number;
  got: number;
  total: number;
  wrongCount: number;
  byKnowledge: { knowledge_point: string; lost: number; full: number }[];
}

const exams = ref<ExamItem[]>([]);
const file = ref<File | null>(null);
const pasted = ref('');
const recognizing = ref(false);
const message = ref('');
const detail = ref<{ paper: ExamItem; questions: QuestionItem[]; review?: { report: string } } | null>(null);
const report = ref('');
const stats = ref<Stats | null>(null);
const compare = ref<{ summary: string; series: { date: string; name: string; rate: number }[] } | null>(null);
const chartEl = ref<HTMLElement>();
let chart: echarts.ECharts | null = null;

async function load() {
  const res = await fetch('/api/reviews');
  const data = await res.json();
  exams.value = data.exams ?? [];
  const cmp = await fetch('/api/reviews/compare').then((r) => r.json());
  compare.value = cmp;
  await nextTick();
  renderChart();
}

function renderChart() {
  if (!chartEl.value || !compare.value) return;
  chart ??= echarts.init(chartEl.value);
  const series = compare.value.series;
  chart.setOption({
    grid: { left: 45, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: series.map((s) => s.date) },
    yAxis: { type: 'value', min: 0, max: 100, name: '得分率%' },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'line',
        smooth: true,
        data: series.map((s) => s.rate),
        label: { show: true, formatter: '{c}%' },
        itemStyle: { color: '#2563eb' },
        areaStyle: { opacity: 0.08 },
      },
    ],
  });
}

function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function recognize() {
  recognizing.value = true;
  message.value = '';
  try {
    let res: Response;
    if (file.value) {
      const form = new FormData();
      form.append('file', file.value);
      res = await fetch('/api/reviews/recognize', { method: 'POST', body: form });
    } else {
      res = await fetch('/api/reviews/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasted.value, name: '粘贴的试卷' }),
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? '识别失败');
    message.value = `识别成功：${data.questions} 道题`;
    pasted.value = '';
    file.value = null;
    await load();
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
  } finally {
    recognizing.value = false;
  }
}

async function open(exam: ExamItem) {
  const res = await fetch(`/api/reviews/${exam.exam_id}`);
  detail.value = await res.json();
  report.value = detail.value?.review?.report ?? '';
}

async function analyze(exam: ExamItem) {
  message.value = '正在生成复盘报告…';
  const res = await fetch(`/api/reviews/${exam.exam_id}/analyze`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    message.value = data.message ?? '复盘失败';
    return;
  }
  report.value = data.report;
  stats.value = data.stats;
  message.value = `复盘完成：失分知识点 ${data.stats.byKnowledge.length} 个，新增错题 ${data.wrongAdded} 道`;
  await load();
  await open(exam);
}

onMounted(load);
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>考试复盘</h2>
      <router-link to="/mastery" class="back">掌握度 →</router-link>
    </header>

    <section class="panel">
      <h3>上传整卷</h3>
      <div class="row">
        <input type="file" accept="image/png,image/jpeg,image/webp,.pdf,.docx,.txt,.md" @change="pick" />
        <button class="primary" :disabled="recognizing || (!file && !pasted.trim())" @click="recognize">
          {{ recognizing ? '识别中…' : '识别整卷' }}
        </button>
      </div>
      <p class="hint">支持拍照（PNG/JPG）、PDF、Word、文本；识别题目、作答、批改痕迹与得分。</p>
      <textarea v-model="pasted" rows="3" placeholder="或者直接粘贴试卷文本…"></textarea>
      <p v-if="message" class="msg">{{ message }}</p>
    </section>

    <section class="panel">
      <h3>考试记录</h3>
      <table class="exam-table">
        <thead><tr><th>试卷</th><th>日期</th><th>得分</th><th>题数</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="e in exams" :key="e.exam_id">
            <td>{{ e.name }}</td>
            <td>{{ e.exam_date }}</td>
            <td>{{ e.my_score }}/{{ e.total_score }}</td>
            <td>{{ e.question_count }}</td>
            <td>{{ e.reviewed ? '已复盘' : '待复盘' }}</td>
            <td class="ops">
              <button class="ghost" @click="open(e)">查看</button>
              <button class="primary small" @click="analyze(e)">复盘</button>
            </td>
          </tr>
          <tr v-if="exams.length === 0"><td colspan="6" class="empty">还没有考试记录</td></tr>
        </tbody>
      </table>
    </section>

    <section v-if="stats" class="panel">
      <h3>本次结果</h3>
      <p>得分率 <strong>{{ stats.rate }}%</strong>（{{ stats.got }}/{{ stats.total }}），错题 {{ stats.wrongCount }} 道。</p>
      <p>失分知识点：<span v-for="k in stats.byKnowledge.slice(0, 5)" :key="k.knowledge_point" class="tag">{{ k.knowledge_point }} -{{ k.lost }}分</span></p>
    </section>

    <section v-if="report" class="panel">
      <h3>复盘报告</h3>
      <MarkdownView :text="report" />
    </section>

    <section v-if="detail" class="panel">
      <h3>逐题明细（{{ detail.paper.name }}）</h3>
      <table class="exam-table">
        <thead><tr><th>题号</th><th>知识点</th><th>得分</th><th>我的答案</th><th>正确答案</th><th>错因</th></tr></thead>
        <tbody>
          <tr v-for="q in detail.questions" :key="q.question_no" :class="{ wrong: q.is_correct === 0 }">
            <td>{{ q.question_no }}</td>
            <td>{{ q.knowledge_point }}</td>
            <td>{{ q.got_score }}/{{ q.full_score }}</td>
            <td>{{ q.student_answer ?? '-' }}</td>
            <td>{{ q.correct_answer ?? '-' }}</td>
            <td>{{ q.error_reason ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3>趋势对比</h3>
      <p>{{ compare?.summary }}</p>
      <div ref="chartEl" class="chart"></div>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 900px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
h3 { margin: 0 0 10px; font-size: 15px; }
.row { display: flex; gap: 12px; align-items: center; }
button { border: none; border-radius: 8px; padding: 8px 16px; font: inherit; cursor: pointer; }
.primary { background: #2563eb; color: #fff; }
.primary:disabled { background: #93c5fd; }
.ghost { background: #f3f4f6; }
.small { padding: 4px 10px; font-size: 13px; }
textarea { width: 100%; margin-top: 10px; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; font: inherit; box-sizing: border-box; }
.hint, .msg { color: #6b7280; font-size: 13px; }
.msg { color: #b45309; }
.exam-table { width: 100%; border-collapse: collapse; }
.exam-table th, .exam-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f0f1f3; font-size: 13px; }
.exam-table tr.wrong { background: #fef2f2; }
.ops { display: flex; gap: 8px; }
.empty { text-align: center; color: #6b7280; }
.tag { display: inline-block; margin-left: 8px; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.chart { height: 260px; }
</style>