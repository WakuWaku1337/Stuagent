<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { EditPen, RefreshRight } from '@element-plus/icons-vue';
import MarkdownView from '../components/MarkdownView.vue';
import {
  answerDaily,
  fetchDaily,
  startDaily as apiStartDaily,
  type DailyOverview,
} from '../api/daily';

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
const subject = ref('数学');
const difficulty = ref('auto');
const difficultyHint = ref<{ difficulty: string; probability: number | null; reason: string } | null>(null);
const count = ref(3);
const route = useRoute();

const daily = ref<DailyOverview | null>(null);
const dailyLoading = ref(false);
const dailyStarting = ref(false);
const dailyMode = ref(false);

onMounted(() => {
  const kp = route.query.kp;
  if (typeof kp === 'string' && kp.trim()) knowledgePoint.value = kp.trim();
  void loadDaily();
  void loadDifficulty();
});

let difficultyTimer: ReturnType<typeof setTimeout> | undefined;
watch(knowledgePoint, () => {
  if (difficultyTimer) clearTimeout(difficultyTimer);
  difficultyTimer = setTimeout(() => void loadDifficulty(), 300);
});

async function loadDifficulty() {
  const point = knowledgePoint.value.trim();
  if (!point) {
    difficultyHint.value = null;
    return;
  }
  try {
    const res = await fetch(`/api/quiz/difficulty?knowledge_point=${encodeURIComponent(point)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '读取难度建议失败');
    difficultyHint.value = {
      difficulty: data.difficulty,
      probability: data.probability,
      reason: data.reason,
    };
  } catch {
    difficultyHint.value = null;
  }
}
const questions = ref<Question[]>([]);
const sessionId = ref('');
const answers = ref<Record<string, string>>({});
const results = ref<Record<string, GradeResult>>({});
const loading = ref(false);
const message = ref('');

const answeredCount = computed(() => Object.keys(results.value).length);
const correctCount = computed(() => Object.values(results.value).filter((r) => r.is_correct).length);
const accuracy = computed(() =>
  answeredCount.value ? Math.round((correctCount.value / answeredCount.value) * 100) : 0,
);
const allAnswered = computed(
  () => questions.value.length > 0 && answeredCount.value === questions.value.length,
);
const dailyPractice = computed(() => daily.value?.practice ?? null);
const dailyAnswered = computed(() => daily.value?.answered_ids.length ?? 0);
const dailyPercent = computed(() => {
  const practice = dailyPractice.value;
  if (!practice || practice.total === 0) return 0;
  if (practice.status === 'completed') return 100;
  return Math.min(100, Math.round((dailyAnswered.value / practice.total) * 100));
});

async function loadDaily() {
  dailyLoading.value = true;
  try {
    daily.value = await fetchDaily();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    dailyLoading.value = false;
  }
}

async function beginDaily() {
  dailyStarting.value = true;
  message.value = '';
  try {
    const result = await apiStartDaily(subject.value || undefined);
    daily.value = {
      practice: result.practice,
      questions: result.questions,
      answered_ids: result.answered_ids,
      streak: result.streak,
      history: daily.value?.history ?? [],
      recommendation: daily.value?.recommendation ?? { focus_points: [], due_wrong: 0 },
    };
    const pending = result.questions.filter((q) => !result.answered_ids.includes(q.question_id));
    questions.value = pending.length ? pending : result.questions;
    sessionId.value = result.practice.session_id;
    answers.value = {};
    results.value = {};
    dailyMode.value = true;
    ElMessage.success(result.reused ? '继续今日练习' : '今日练习已开始');
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    dailyStarting.value = false;
  }
}

function resumeDaily() {
  if (!daily.value?.practice) return;
  const pending = daily.value.questions.filter(
    (q) => !daily.value!.answered_ids.includes(q.question_id),
  );
  if (pending.length === 0) {
    ElMessage.info('今日练习暂无待答题目');
    return;
  }
  questions.value = pending;
  sessionId.value = daily.value.practice.session_id;
  answers.value = {};
  results.value = {};
  message.value = '';
  dailyMode.value = true;
}

async function generate() {
  loading.value = true;
  message.value = '';
  dailyMode.value = false;
  questions.value = [];
  answers.value = {};
  results.value = {};
  try {
    const res = await fetch('/api/quiz/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledge_point: knowledgePoint.value,
        difficulty: difficulty.value === 'auto' ? undefined : difficulty.value,
        count: count.value,
        subject: subject.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '生成失败');
    questions.value = data.questions;
    sessionId.value = data.session_id;
    if (data.recommended_difficulty) {
      difficultyHint.value = {
        difficulty: data.recommended_difficulty,
        probability: data.mastery ?? null,
        reason: `本次按${data.difficulty}难度生成`,
      };
    }
    ElMessage.success(`已生成 ${data.questions.length} 道题（${data.difficulty ?? '自动'}）`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
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
  message.value = '';
  try {
    if (dailyMode.value) {
      const data = await answerDaily(q.question_id, answer);
      results.value[q.question_id] = data.result;
      if (daily.value) {
        daily.value = {
          ...daily.value,
          practice: data.practice,
          streak: data.streak,
          answered_ids: [...new Set([...daily.value.answered_ids, q.question_id])],
        };
      }
      if (data.completed) {
        ElMessage.success(`今日练习完成，正确率 ${data.practice.score ?? 0}%`);
        await loadDaily();
      } else if (Object.keys(results.value).length === questions.value.length) {
        ElMessage.success('本组练习已完成');
      }
      return;
    }
    const res = await fetch('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId.value,
        question_id: q.question_id,
        answer,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '提交失败');
    results.value[q.question_id] = data;
    if (Object.keys(results.value).length === questions.value.length) {
      ElMessage.success('本组练习已完成');
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  }
}

function reset() {
  questions.value = [];
  answers.value = {};
  results.value = {};
  message.value = '';
  dailyMode.value = false;
}
</script>

<template>
  <div class="page narrow">
    <section class="panel daily-panel" v-loading="dailyLoading">
      <div class="daily-head">
        <div>
          <p class="daily-kicker">每日练习</p>
          <h2 class="panel-title">
            {{ dailyPractice?.status === 'completed' ? '今天的练习已完成' : '每天 5 道，补上薄弱点' }}
          </h2>
          <p class="panel-sub">
            按掌握度与到期错题自动选题，作答后更新掌握度并收录错题。
          </p>
        </div>
        <div class="daily-head-side">
          <el-tag v-if="dailyPractice?.status === 'completed'" type="success" effect="plain" disable-transitions>
            今日已完成
          </el-tag>
          <el-tag v-else-if="dailyMode" type="primary" effect="plain" disable-transitions>正在练习</el-tag>
          <span class="daily-streak">连续 <b>{{ daily?.streak ?? 0 }}</b> 天</span>
        </div>
      </div>

      <div class="daily-body">
        <div class="daily-meta">
          <span>今日 {{ dailyPractice?.total ?? 5 }} 题</span>
          <span v-if="dailyPractice">
            已完成 {{ dailyPractice.status === 'completed' ? dailyPractice.total : dailyAnswered }} / {{ dailyPractice.total }}
          </span>
          <span>到期错题 {{ daily?.recommendation.due_wrong ?? 0 }} 道</span>
        </div>
        <div class="daily-focus">
          <span class="daily-focus-label">今日重点</span>
          <el-tag
            v-for="point in daily?.recommendation.focus_points ?? []"
            :key="point"
            size="small"
            type="info"
            effect="plain"
            disable-transitions
          >
            {{ point }}
          </el-tag>
        </div>
        <el-progress :percentage="dailyPercent" :stroke-width="7" :show-text="false" />
        <div class="daily-dots">
          <span
            v-for="item in daily?.history ?? []"
            :key="item.date"
            class="daily-dot"
            :class="{ done: item.status === 'completed' }"
            :title="`${item.date} ${item.status === 'completed' ? '已完成' : '进行中'}`"
          >
            {{ item.date.slice(5) }}
          </span>
          <span v-if="!(daily?.history ?? []).length" class="daily-empty">还没有每日练习记录</span>
        </div>
      </div>

      <div class="daily-footer">
        <p class="daily-hint">
          {{
            dailyPractice?.status === 'completed'
              ? `今日正确率 ${dailyPractice.score ?? 0}%`
              : '每天一组，建议先完成每日练习，再做自选知识点练习。'
          }}
        </p>
        <div class="daily-actions">
          <el-button v-if="dailyPractice?.status === 'completed'" text @click="loadDaily">刷新记录</el-button>
          <el-button
            v-else-if="dailyPractice?.status === 'active' && !dailyMode"
            type="primary"
            :loading="dailyStarting"
            @click="resumeDaily"
          >
            继续今日练习
          </el-button>
          <el-button
            v-else-if="!dailyPractice"
            type="primary"
            :loading="dailyStarting"
            @click="beginDaily"
          >
            开始今日练习
          </el-button>
          <span v-else-if="dailyMode" class="daily-active">答题中</span>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">设置练习</h2>
          <p class="panel-sub">模型按知识点与难度生成选择题，提交后即时判分并更新掌握度</p>
        </div>
        <el-button v-if="questions.length" text :icon="RefreshRight" @click="reset">重置</el-button>
      </div>
      <div class="panel-body">
        <div class="quiz-setup">
          <div class="setup-field">
            <label class="field-label">学科</label>
            <el-input v-model="subject" placeholder="数学" />
          </div>
          <div class="setup-field wide">
            <label class="field-label">知识点</label>
            <el-input v-model="knowledgePoint" placeholder="例如：勾股定理" @keyup.enter="generate" />
          </div>
          <div class="setup-field">
            <label class="field-label">难度</label>
            <el-radio-group v-model="difficulty">
              <el-radio-button value="auto">推荐</el-radio-button>
              <el-radio-button value="基础">基础</el-radio-button>
              <el-radio-button value="中等">中等</el-radio-button>
              <el-radio-button value="拔高">拔高</el-radio-button>
            </el-radio-group>
            <span v-if="difficultyHint" class="difficulty-hint">
              推荐「{{ difficultyHint.difficulty }}」{{ difficultyHint.probability !== null ? ` · 掌握度 ${difficultyHint.probability}%` : '' }}
            </span>
          </div>
          <div class="setup-field">
            <label class="field-label">题量</label>
            <el-input-number v-model="count" :min="1" :max="10" />
          </div>
          <el-button type="primary" :icon="EditPen" :loading="loading" class="generate-btn" @click="generate">
            {{ loading ? '正在出题…' : '生成题目' }}
          </el-button>
        </div>

        <el-alert
          v-if="message"
          class="quiz-alert"
          :title="message"
          type="warning"
          :closable="false"
          show-icon
        />
      </div>
    </section>

    <section v-if="questions.length" class="panel quiz-progress">
      <div class="progress-stat">
        <span class="progress-label">题量</span>
        <span class="progress-value numeric">{{ questions.length }}</span>
      </div>
      <div class="progress-stat">
        <span class="progress-label">已答</span>
        <span class="progress-value numeric">{{ answeredCount }} / {{ questions.length }}</span>
      </div>
      <div class="progress-stat">
        <span class="progress-label">答对</span>
        <span class="progress-value numeric">{{ correctCount }}</span>
      </div>
      <div class="progress-bar">
        <span class="progress-label">正确率</span>
        <el-progress
          :percentage="accuracy"
          :stroke-width="8"
          :color="accuracy >= 60 ? '#2c7a5b' : '#c58a3d'"
        />
      </div>
    </section>

    <el-result
      v-if="allAnswered"
      class="quiz-result"
      :icon="accuracy >= 60 ? 'success' : 'warning'"
      :title="`本组正确率 ${accuracy}%`"
      :sub-title="`共 ${questions.length} 题，答对 ${correctCount} 题。掌握度已按作答结果更新。`"
    >
      <template #extra>
        <el-button type="primary" :icon="EditPen" @click="generate">再练一组</el-button>
        <el-button @click="reset">调整设置</el-button>
      </template>
    </el-result>

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
        <el-tag
          v-if="results[q.question_id]"
          size="small"
          :type="results[q.question_id].is_correct ? 'success' : 'danger'"
          effect="dark"
        >
          {{ results[q.question_id].is_correct ? '正确' : '错误' }}
        </el-tag>
      </div>

      <div class="panel-body">
        <el-radio-group
          v-model="answers[q.question_id]"
          :disabled="!!results[q.question_id]"
          class="quiz-options"
        >
          <el-radio
            v-for="(text, key) in q.options"
            :key="key"
            :value="key"
            border
            class="quiz-option"
          >
            <span class="option-key">{{ key }}</span>
            <span>{{ text }}</span>
          </el-radio>
        </el-radio-group>

        <template v-if="results[q.question_id]">
          <el-alert
            class="question-feedback"
            :type="results[q.question_id].is_correct ? 'success' : 'error'"
            :closable="false"
            show-icon
          >
            <template #title>
              <span v-if="results[q.question_id].is_correct">回答正确</span>
              <span v-else>回答错误，正确答案为 {{ results[q.question_id].correct_answer }}</span>
            </template>
            <div v-if="results[q.question_id].explanation" class="feedback-explain">
              <MarkdownView :text="results[q.question_id].explanation ?? ''" />
            </div>
          </el-alert>
          <div class="mastery-line">
            <span class="mastery-label">该知识点当前掌握度</span>
            <el-progress
              class="mastery-progress"
              :percentage="Math.round(results[q.question_id].mastery * 1000) / 10"
              :stroke-width="7"
            />
          </div>
        </template>

        <div v-else class="submit-line">
          <el-button
            type="primary"
            :disabled="!answers[q.question_id]"
            @click="submitQuestion(q)"
          >
            提交本题
          </el-button>
          <span class="submit-hint">提交后不可修改答案</span>
        </div>
      </div>
    </section>

    <section v-if="questions.length === 0" class="panel">
      <div class="panel-body">
        <el-empty description="设置知识点与难度后生成练习。作答结果会自动写入掌握度与错题本。" :image-size="86" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.daily-panel {
  margin-bottom: 18px;
  padding: 20px 22px 18px;
  background:
    linear-gradient(120deg, rgba(47, 91, 234, 0.06), rgba(255, 255, 255, 0) 55%),
    #fff;
}

.daily-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.daily-kicker {
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 0.04em;
}

.daily-head .panel-title {
  margin-top: 2px;
}

.daily-head-side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.daily-streak {
  font-size: 11.5px;
  color: var(--muted);
}

.daily-streak b {
  font-family: var(--font-num);
  color: var(--accent);
  font-size: 15px;
}

.daily-body {
  margin-top: 14px;
}

.daily-meta {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.daily-focus {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 9px;
}

.daily-focus-label {
  font-size: 11px;
  color: var(--faint);
}

.daily-body :deep(.el-progress) {
  margin-top: 12px;
}

.daily-dots {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.daily-dot {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--paper);
  color: var(--faint);
  font-size: 10px;
}

.daily-dot.done {
  background: var(--success-soft);
  color: var(--success);
}

.daily-empty {
  font-size: 11px;
  color: var(--faint);
}

.daily-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.daily-hint {
  font-size: 11.5px;
  color: var(--faint);
}

.daily-active {
  font-size: 11.5px;
  color: var(--success);
}

.quiz-setup {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}

.setup-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setup-field.wide {
  min-width: 240px;
  flex: 1;
}

.setup-field :deep(.el-input-number) {
  width: 116px;
}

.field-label {
  font-size: 12px;
  color: var(--muted);
}

.difficulty-hint {
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--faint);
  line-height: 1.4;
}

.generate-btn {
  height: 32px;
  margin-bottom: 1px;
}

.quiz-alert {
  margin-top: 14px;
}

.quiz-progress {
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
  padding: 15px 22px;
  margin-top: 18px;
}

.progress-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.progress-label {
  font-size: 11.5px;
  color: var(--muted);
}

.progress-value {
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 600;
}

.progress-bar {
  flex: 1;
  min-width: 200px;
}

.progress-bar .progress-label {
  display: block;
  margin-bottom: 4px;
}

.quiz-result {
  margin-top: 18px;
  padding: 10px 0 2px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.question {
  margin-top: 18px;
}

.question-head {
  align-items: flex-start;
}

.question-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.question-stem {
  margin-top: 10px;
  font-size: 14.5px;
}

.question-stem :deep(.markdown) {
  font-size: 14.5px;
  color: var(--ink);
}

.quiz-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.quiz-option {
  width: 100%;
  height: auto;
  margin: 0;
  padding: 11px 14px;
  border-radius: 9px;
  background: #fbfcfb;
}

.quiz-option :deep(.el-radio__label) {
  display: flex;
  align-items: baseline;
  gap: 9px;
  white-space: normal;
  line-height: 1.6;
  font-size: 13.5px;
  color: var(--ink-soft);
}

.quiz-option.is-checked {
  background: var(--accent-soft);
}

.option-key {
  flex: none;
  font-family: var(--font-num);
  font-weight: 600;
  color: var(--muted);
}

.quiz-option.is-checked .option-key {
  color: var(--accent);
}

.question-feedback {
  margin-top: 14px;
}

.feedback-explain {
  margin-top: 4px;
  font-size: 13px;
}

.mastery-line {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
}

.mastery-label {
  flex: none;
  font-size: 12px;
  color: var(--muted);
}

.mastery-progress {
  flex: 1;
  max-width: 320px;
}

.submit-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.submit-hint {
  font-size: 11.5px;
  color: var(--faint);
}

@media (max-width: 640px) {
  .setup-field.wide {
    min-width: 100%;
  }

  .generate-btn {
    width: 100%;
  }

  .quiz-progress {
    gap: 18px;
  }
}
</style>