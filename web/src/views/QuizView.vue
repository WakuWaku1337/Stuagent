<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { EditPen, RefreshRight } from '@element-plus/icons-vue';
import MarkdownView from '../components/MarkdownView.vue';

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
const difficulty = ref('基础');
const count = ref(3);
const route = useRoute();

onMounted(() => {
  const kp = route.query.kp;
  if (typeof kp === 'string' && kp.trim()) knowledgePoint.value = kp.trim();
});
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
        subject: subject.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '生成失败');
    questions.value = data.questions;
    sessionId.value = data.session_id;
    ElMessage.success(`已生成 ${data.questions.length} 道题`);
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
}
</script>

<template>
  <div class="page narrow">
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
              <el-radio-button value="基础">基础</el-radio-button>
              <el-radio-button value="中等">中等</el-radio-button>
              <el-radio-button value="拔高">拔高</el-radio-button>
            </el-radio-group>
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