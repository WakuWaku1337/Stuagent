<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Clock, Notebook, Refresh, TrendCharts } from '@element-plus/icons-vue';
import MetricCard from '../components/MetricCard.vue';
import MarkdownView from '../components/MarkdownView.vue';
import { api, type WrongRecord } from '../api/data';

const records = ref<WrongRecord[]>([]);
const dueOnly = ref(false);
const due = ref(0);
const loading = ref(false);
const message = ref('');

const visible = computed(() =>
  dueOnly.value
    ? records.value.filter((r) => r.next_review <= Date.now())
    : records.value,
);
const reviewTotal = computed(() => records.value.reduce((sum, r) => sum + r.review_count, 0));
const nextDue = computed(() => {
  const upcoming = records.value
    .map((r) => r.next_review)
    .filter((ts) => ts > Date.now())
    .sort((a, b) => a - b);
  return upcoming[0] ?? null;
});

async function load() {
  loading.value = true;
  try {
    const data = await api.wrongbook();
    records.value = data.records;
    due.value = data.due;
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function review(r: WrongRecord, quality: number) {
  message.value = '';
  try {
    const res = await fetch(`/api/wrongbook/${r.record_id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quality }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '操作失败');
    message.value =
      quality >= 3 ? `已记录复习，${data.interval_days} 天后再见` : '已放入短期复习，明天再练';
    ElMessage.success(message.value);
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  }
}

async function remove(r: WrongRecord) {
  try {
    const res = await fetch(`/api/wrongbook/${r.record_id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('移除失败');
    ElMessage.success('已从错题本移除');
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  }
}

onMounted(load);

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function isDue(ts: number) {
  return ts <= Date.now();
}
</script>

<template>
  <div class="page narrow">
    <section class="metric-grid wrong-metrics">
      <MetricCard
        label="今日待复习"
        :value="due"
        suffix="题"
        :icon="Clock"
        tone="warning"
        hint="按遗忘曲线到期"
      />
      <MetricCard
        label="错题总数"
        :value="records.length"
        suffix="题"
        :icon="Notebook"
        tone="accent"
        hint="答错后自动收录"
      />
      <MetricCard
        label="累计复习"
        :value="reviewTotal"
        suffix="次"
        :icon="TrendCharts"
        tone="success"
        :hint="nextDue ? `下次到期 ${fmtDate(nextDue)}` : '暂无后续安排'"
      />
    </section>

    <section class="panel review-toolbar">
      <div class="toolbar-left">
        <el-switch v-model="dueOnly" />
        <span class="toolbar-text">只看今日到期</span>
        <span class="toolbar-hint">{{ dueOnly ? `当前 ${visible.length} 题待复习` : `共 ${records.length} 题` }}</span>
      </div>
      <div class="toolbar-right">
        <span v-if="message" class="toolbar-message">{{ message }}</span>
        <el-button :icon="Refresh" :loading="loading" text @click="load">刷新</el-button>
      </div>
    </section>

    <section
      v-for="(r, index) in visible"
      :key="r.record_id"
      class="panel wrong-card"
    >
      <div class="wrong-card-head">
        <div class="wrong-tags">
          <el-tag size="small" effect="plain">第 {{ index + 1 }} 题</el-tag>
          <el-tag size="small" effect="plain" type="info">
            {{ r.question_snapshot.knowledge_point ?? '未标注' }}
          </el-tag>
          <el-tag v-if="r.question_snapshot.difficulty" size="small" effect="plain" type="warning">
            {{ r.question_snapshot.difficulty }}
          </el-tag>
          <el-tag v-if="isDue(r.next_review)" size="small" type="danger" effect="dark">今日到期</el-tag>
        </div>
        <span class="wrong-next" :class="{ due: isDue(r.next_review) }">
          下次复习 {{ fmtDate(r.next_review) }}
        </span>
      </div>

      <div class="wrong-stem">
        <MarkdownView :text="r.question_snapshot.content" />
      </div>

      <p class="wrong-meta">
        错因：{{ r.reason ?? '未记录' }} · 已复习 {{ r.review_count }} 次 · 当前间隔
        {{ r.interval_days }} 天
      </p>

      <div v-if="r.question_snapshot.options" class="wrong-options">
        <span
          v-for="(text, key) in r.question_snapshot.options"
          :key="key"
          class="wrong-option"
          :class="{ correct: key === r.question_snapshot.answer }"
        >
          <span class="option-key">{{ key }}</span>{{ text }}
        </span>
      </div>

      <p class="wrong-answer">
        正确答案：<strong>{{ r.question_snapshot.answer ?? '-' }}</strong>
        <span v-if="r.student_answer" class="wrong-mine"> · 我的答案：{{ r.student_answer }}</span>
      </p>

      <el-collapse v-if="r.question_snapshot.explanation" class="wrong-explain">
        <el-collapse-item title="查看解析" name="explain">
          <MarkdownView :text="r.question_snapshot.explanation" />
        </el-collapse-item>
      </el-collapse>

      <div class="wrong-actions">
        <el-button type="success" plain size="small" @click="review(r, 5)">记住了</el-button>
        <el-button type="warning" plain size="small" @click="review(r, 2)">还没掌握</el-button>
        <el-popconfirm
          title="从错题本移除这道题？"
          confirm-button-text="移除"
          cancel-button-text="取消"
          @confirm="remove(r)"
        >
          <template #reference>
            <el-button link type="danger" size="small">移除</el-button>
          </template>
        </el-popconfirm>
      </div>
    </section>

    <section v-if="!loading && visible.length === 0" class="panel">
      <div class="panel-body">
        <el-empty
          :description="dueOnly && records.length ? '今天没有到期的错题，可以切换到全部错题查看' : '暂无错题。答错的题会自动收录。'"
          :image-size="86"
        >
          <el-button v-if="dueOnly && records.length" @click="dueOnly = false">查看全部错题</el-button>
          <el-button v-else type="primary" @click="$router.push('/quiz')">去练习</el-button>
        </el-empty>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wrong-metrics {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.review-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 13px 20px;
  margin-top: 18px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toolbar-text {
  font-size: 13px;
  color: var(--ink-soft);
}

.toolbar-hint {
  font-size: 12px;
  color: var(--faint);
}

.toolbar-message {
  font-size: 12px;
  color: var(--muted);
}

.wrong-card {
  padding: 20px 22px;
  margin-top: 14px;
}

.wrong-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.wrong-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wrong-next {
  flex: none;
  font-size: 11.5px;
  color: var(--faint);
  white-space: nowrap;
}

.wrong-next.due {
  color: var(--warning);
  font-weight: 600;
}

.wrong-stem {
  margin-top: 12px;
  font-size: 14.5px;
}

.wrong-stem :deep(.markdown) {
  font-size: 14.5px;
  color: var(--ink);
}

.wrong-meta {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--faint);
}

.wrong-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 16px;
  margin-top: 12px;
}

.wrong-option {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 6px 10px;
  border-radius: 7px;
  background: #f8faf9;
  font-size: 13px;
  color: var(--ink-soft);
}

.wrong-option.correct {
  background: var(--success-soft);
  color: var(--success);
  font-weight: 600;
}

.option-key {
  font-family: var(--font-num);
  font-weight: 600;
  color: inherit;
}

.wrong-answer {
  margin-top: 12px;
  font-size: 13px;
  color: var(--ink-soft);
}

.wrong-answer strong {
  color: var(--success);
}

.wrong-mine {
  color: var(--muted);
}

.wrong-explain {
  margin-top: 8px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
}

.wrong-explain :deep(.el-collapse-item__header) {
  height: 38px;
  font-size: 12px;
  color: var(--muted);
}

.wrong-explain :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
}

.wrong-explain :deep(.markdown) {
  font-size: 13px;
  padding-bottom: 8px;
}

.wrong-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

@media (max-width: 900px) {
  .wrong-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .wrong-options {
    grid-template-columns: minmax(0, 1fr);
  }

  .wrong-card-head {
    flex-direction: column;
    gap: 6px;
  }
}
</style>