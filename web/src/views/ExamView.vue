<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { EditPen, Timer } from '@element-plus/icons-vue';
import MarkdownView from '../components/MarkdownView.vue';

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
  knowledge_point?: string;
}
interface AnalysisItem {
  knowledge_point: string;
  wrong: number;
  total: number;
}

const count = ref(5);
const duration = ref(10);
const sessionId = ref('');
const questions = ref<Question[]>([]);
const answers = ref<Record<string, string>>({});
const results = ref<ResultItem[]>([]);
const analysis = ref<AnalysisItem[]>([]);
const score = ref<number | null>(null);
const remaining = ref(0);
const loading = ref(false);
const submitting = ref(false);
const message = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const answeredCount = computed(() => Object.values(answers.value).filter(Boolean).length);
const correctCount = computed(() => results.value.filter((r) => r.is_correct).length);
const progress = computed(() =>
  questions.value.length ? Math.round((answeredCount.value / questions.value.length) * 100) : 0,
);
const urgent = computed(() => remaining.value > 0 && remaining.value <= 60);

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer(minutes: number) {
  stopTimer();
  remaining.value = minutes * 60;
  timer = setInterval(() => {
    remaining.value -= 1;
    if (remaining.value <= 0) {
      stopTimer();
      ElMessage.warning('考试时间到，正在自动交卷');
      void submit(true);
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
    ElMessage.success(`已组卷 ${data.questions.length} 题`);
    startTimer(data.duration_min);
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    loading.value = false;
  }
}

async function submit(auto = false) {
  if (submitting.value) return;
  if (!auto && answeredCount.value < questions.value.length) {
    try {
      await ElMessageBox.confirm(
        `还有 ${questions.value.length - answeredCount.value} 题未作答，确认交卷？`,
        '交卷确认',
        { confirmButtonText: '交卷', cancelButtonText: '继续作答', type: 'warning' },
      );
    } catch {
      return;
    }
  }
  submitting.value = true;
  stopTimer();
  const payload = questions.value.map((q) => ({
    question_id: q.question_id,
    answer: answers.value[q.question_id] ?? '',
  }));
  try {
    const res = await fetch(`/api/exam/${sessionId.value}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '交卷失败');
    score.value = data.score;
    results.value = data.results;
    analysis.value = data.analysis ?? [];
    questions.value = [];
    ElMessage.success(`交卷完成，得分 ${data.score}`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    submitting.value = false;
  }
}

function reset() {
  score.value = null;
  results.value = [];
  analysis.value = [];
  answers.value = {};
  questions.value = [];
  message.value = '';
  remaining.value = 0;
}

onBeforeUnmount(stopTimer);
</script>

<template>
  <div class="page narrow">
    <section v-if="questions.length === 0 && score === null" class="panel exam-setup">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">开始模拟考试</h2>
          <p class="panel-sub">从题库随机抽题，限时作答，交卷后按知识点统计失分</p>
        </div>
        <el-icon class="setup-icon"><Timer /></el-icon>
      </div>
      <div class="panel-body">
        <div class="setup-grid">
          <div class="setup-field">
            <label class="field-label">题量</label>
            <el-input-number v-model="count" :min="1" :max="30" />
          </div>
          <div class="setup-field">
            <label class="field-label">时长（分钟）</label>
            <el-input-number v-model="duration" :min="1" :max="120" />
          </div>
          <el-button type="primary" :icon="EditPen" :loading="loading" @click="start">
            {{ loading ? '正在组卷…' : '开始考试' }}
          </el-button>
        </div>
        <el-alert
          class="exam-note"
          title="题库为空时请先在「智能出题」中生成题目，或从资料库提取题库。"
          type="info"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="message"
          class="exam-note"
          :title="message"
          type="error"
          :closable="false"
          show-icon
        />
      </div>
    </section>

    <template v-if="questions.length > 0">
      <section class="panel exam-sticky">
        <div class="timer-block">
          <span class="timer-label">剩余时间</span>
          <span class="timer-value numeric" :class="{ urgent }">{{ fmt(remaining) }}</span>
        </div>
        <div class="exam-progress">
          <div class="exam-progress-head">
            <span>作答进度</span>
            <span class="numeric">{{ answeredCount }} / {{ questions.length }}</span>
          </div>
          <el-progress :percentage="progress" :stroke-width="7" :show-text="false" />
        </div>
        <el-button type="primary" :loading="submitting" @click="submit()">交卷</el-button>
      </section>

      <section v-for="(q, i) in questions" :key="q.question_id" class="panel question">
        <div class="panel-head question-head">
          <div>
            <div class="question-tags">
              <el-tag size="small" effect="plain">第 {{ i + 1 }} 题</el-tag>
              <el-tag size="small" effect="plain" type="info">{{ q.knowledge_point }}</el-tag>
              <el-tag size="small" effect="plain" type="warning">{{ q.difficulty }}</el-tag>
            </div>
            <div class="question-stem">
              <MarkdownView :text="q.content" />
            </div>
          </div>
        </div>
        <div class="panel-body">
          <el-radio-group v-model="answers[q.question_id]" class="exam-options">
            <el-radio v-for="(text, key) in q.options" :key="key" :value="key" border class="exam-option">
              <span class="option-key">{{ key }}</span>
              <span>{{ text }}</span>
            </el-radio>
          </el-radio-group>
        </div>
      </section>
    </template>

    <template v-if="score !== null">
      <section class="panel result-hero">
        <el-progress
          type="circle"
          :percentage="score"
          :width="150"
          :stroke-width="10"
          :color="score >= 60 ? '#2c7a5b' : '#c58a3d'"
        />
        <div class="result-main">
          <p class="result-kicker">本次模拟考试</p>
          <h2 class="result-title">得分 {{ score }}<span class="result-unit"> / 100</span></h2>
          <p class="result-meta">
            共 {{ results.length }} 题，答对 {{ correctCount }} 题，答错
            {{ results.length - correctCount }} 题。
          </p>
          <div class="result-actions">
            <el-button type="primary" :icon="Timer" @click="reset">再考一次</el-button>
            <el-button @click="$router.push('/review')">查看考试复盘</el-button>
          </div>
        </div>
      </section>

      <section v-if="analysis.length" class="section panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">失分分布</h2>
            <p class="panel-sub">按知识点统计本次考试的错题数</p>
          </div>
        </div>
        <div class="panel-body">
          <el-table :data="analysis">
            <el-table-column prop="knowledge_point" label="知识点" min-width="220" />
            <el-table-column label="错题 / 总题" width="130" align="center">
              <template #default="{ row }">
                <span class="numeric">{{ row.wrong }} / {{ row.total }}</span>
              </template>
            </el-table-column>
            <el-table-column label="错误率" min-width="200">
              <template #default="{ row }">
                <el-progress
                  :percentage="row.total ? Math.round((row.wrong / row.total) * 100) : 0"
                  :stroke-width="7"
                  :color="row.wrong ? '#c58a3d' : '#2c7a5b'"
                />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="section panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">逐题明细</h2>
            <p class="panel-sub">展开行可查看解析</p>
          </div>
        </div>
        <div class="panel-body">
          <el-table :data="results">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="expand-body">
                  <MarkdownView v-if="row.explanation" :text="row.explanation" />
                  <p v-else class="muted">暂无解析。</p>
                </div>
              </template>
            </el-table-column>
            <el-table-column type="index" label="题号" width="64" />
            <el-table-column label="结果" width="88">
              <template #default="{ row }">
                <el-tag size="small" :type="row.is_correct ? 'success' : 'danger'">
                  {{ row.is_correct ? '正确' : '错误' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="我的答案" width="110">
              <template #default="{ row }">{{ row.student_answer || '未答' }}</template>
            </el-table-column>
            <el-table-column label="正确答案" width="110">
              <template #default="{ row }">{{ row.correct_answer }}</template>
            </el-table-column>
            <el-table-column label="知识点掌握度" min-width="210">
              <template #default="{ row }">
                <el-progress
                  :percentage="Math.round(row.mastery * 1000) / 10"
                  :stroke-width="7"
                />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.exam-setup .setup-icon {
  font-size: 22px;
  color: var(--faint);
}

.setup-grid {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.setup-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--muted);
}

.exam-note {
  margin-top: 14px;
}

.exam-sticky {
  position: sticky;
  top: 12px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
  padding: 14px 22px;
  box-shadow: 0 6px 20px rgba(21, 32, 43, 0.06);
}

.timer-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.timer-label {
  font-size: 11px;
  color: var(--muted);
}

.timer-value {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.2;
}

.timer-value.urgent {
  color: var(--danger);
}

.exam-progress {
  flex: 1;
  min-width: 200px;
}

.exam-progress-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 11.5px;
  color: var(--muted);
}

.question {
  margin-top: 16px;
}

.question-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.question-stem {
  margin-top: 10px;
}

.question-stem :deep(.markdown) {
  font-size: 14.5px;
  color: var(--ink);
}

.exam-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.exam-option {
  width: 100%;
  height: auto;
  margin: 0;
  padding: 11px 14px;
  border-radius: 9px;
  background: #fbfcfb;
}

.exam-option :deep(.el-radio__label) {
  display: flex;
  align-items: baseline;
  gap: 9px;
  white-space: normal;
  line-height: 1.6;
  font-size: 13.5px;
  color: var(--ink-soft);
}

.exam-option.is-checked {
  background: var(--accent-soft);
}

.option-key {
  flex: none;
  font-family: var(--font-num);
  font-weight: 600;
  color: var(--muted);
}

.exam-option.is-checked .option-key {
  color: var(--accent);
}

.result-hero {
  display: flex;
  align-items: center;
  gap: 40px;
  flex-wrap: wrap;
  padding: 28px 32px;
}

.result-main {
  flex: 1;
  min-width: 260px;
}

.result-kicker {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--faint);
}

.result-title {
  margin-top: 4px;
  font-family: var(--font-serif);
  font-size: 32px;
  font-weight: 600;
}

.result-unit {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}

.result-meta {
  margin-top: 6px;
  font-size: 13px;
  color: var(--muted);
}

.result-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.expand-body {
  padding: 10px 16px 14px 48px;
  background: #fafcfb;
}

.expand-body :deep(.markdown) {
  font-size: 13px;
}

@media (max-width: 640px) {
  .exam-sticky {
    gap: 14px;
  }

  .setup-grid {
    width: 100%;
  }

  .result-hero {
    gap: 20px;
    padding: 22px;
  }
}
</style>