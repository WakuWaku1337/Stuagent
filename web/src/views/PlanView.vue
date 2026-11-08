<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Calendar, CircleCheck, Delete, EditPen, Timer, TrendCharts } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  archivePlan,
  fetchPlan,
  generatePlan,
  togglePlanTask,
  updatePlan,
  type LearningPlan,
  type PlanDay,
  type PlanOverview,
  type PlanStats,
  type PlanTask,
  type PlanTaskType,
} from '../api/plan';

const overview = ref<PlanOverview | null>(null);
const stats = ref<PlanStats | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const dialogOpen = ref(false);
const editing = ref(false);
const submitting = ref(false);
const savingTask = ref<string | null>(null);
const form = reactive({ goal: '', days: 7, dailyMinutes: 30, subjects: '' });

const typeMeta: Record<PlanTaskType, { label: string; type: 'primary' | 'success' | 'warning' | 'info' | 'danger' }> = {
  review: { label: '复习', type: 'warning' },
  wrongbook: { label: '错题', type: 'danger' },
  practice: { label: '练习', type: 'primary' },
  reading: { label: '阅读', type: 'info' },
  summary: { label: '复盘', type: 'success' },
};

const plan = computed<LearningPlan | null>(() => overview.value?.plan ?? null);
const content = computed(() => plan.value?.content ?? null);
const progressPercent = computed(() => Math.round((plan.value?.progress ?? 0) * 100));
const completedTasks = computed(() => stats.value?.done ?? 0);
const totalTasks = computed(() => stats.value?.total ?? 0);
const remainingDays = computed(() => stats.value?.remaining_days ?? 0);
const dateRange = computed(() => {
  const days = content.value?.days ?? [];
  return days.length ? `${days[0].date} — ${days[days.length - 1].date}` : '';
});
const subjectsText = computed(() =>
  plan.value?.subjects.length ? plan.value.subjects.join(' / ') : '未指定',
);
const progressColor = computed(() =>
  plan.value?.status === 'completed' ? '#2c7a5b' : '#2f5bea',
);

function todayISO(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isToday(date: string): boolean {
  return date === todayISO();
}

function isDayDone(day: PlanDay): boolean {
  return day.tasks.length > 0 && day.tasks.every((task) => task.done);
}

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true;
  errorMessage.value = '';
  try {
    const data = await fetchPlan();
    overview.value = { plan: data.plan, history: data.history, stats: data.stats };
    stats.value = data.stats;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = false;
  form.goal = '';
  form.days = 7;
  form.dailyMinutes = 30;
  form.subjects = '';
  dialogOpen.value = true;
}

function openAdjust(): void {
  if (!plan.value) return;
  editing.value = true;
  form.goal = plan.value.goal;
  form.days = plan.value.days;
  form.dailyMinutes = plan.value.daily_minutes;
  form.subjects = plan.value.subjects.join('、');
  dialogOpen.value = true;
}

async function submit(): Promise<void> {
  const goal = form.goal.trim();
  if (goal.length < 2) {
    ElMessage.warning('请填写至少 2 个字的学习目标');
    return;
  }
  const subjects = form.subjects
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  submitting.value = true;
  try {
    const input = {
      goal,
      days: form.days,
      dailyMinutes: form.dailyMinutes,
      subjects,
    };
    if (editing.value && plan.value) {
      await updatePlan(plan.value.plan_id, input);
      ElMessage.success('学习计划已调整');
    } else {
      await generatePlan(input);
      ElMessage.success('学习计划已生成');
    }
    dialogOpen.value = false;
    await load(true);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    submitting.value = false;
  }
}

async function toggleTask(task: PlanTask): Promise<void> {
  if (!plan.value || savingTask.value) return;
  savingTask.value = task.task_id;
  try {
    const result = await togglePlanTask(plan.value.plan_id, task.task_id, !task.done);
    overview.value = {
      plan: result.plan,
      history: overview.value?.history ?? [],
      stats: result.stats,
    };
    stats.value = result.stats;
    if (result.plan.status === 'completed') {
      ElMessage.success('计划任务已全部完成');
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingTask.value = null;
  }
}

async function archive(): Promise<void> {
  if (!plan.value) return;
  try {
    await ElMessageBox.confirm(
      '归档后当前计划不再显示，可在“历史计划”中查看。', 
      '归档学习计划',
      { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await archivePlan(plan.value.plan_id);
    ElMessage.success('学习计划已归档');
    await load(true);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page plan-page" v-loading="loading">
    <header class="plan-head">
      <div>
        <h1 class="plan-title">学习计划</h1>
        <p class="plan-sub">把目标拆成每天能完成的小任务，优先补薄弱点与到期错题。</p>
      </div>
      <div v-if="plan" class="plan-actions">
        <el-button :icon="EditPen" @click="openAdjust">调整计划</el-button>
        <el-button plain :icon="Delete" @click="archive">归档</el-button>
        <el-button type="primary" :icon="Calendar" @click="openCreate">新建计划</el-button>
      </div>
      <el-button v-else type="primary" :icon="Calendar" @click="openCreate">生成计划</el-button>
    </header>

    <el-alert
      v-if="errorMessage"
      class="plan-error"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
    />

    <template v-if="plan && content">
      <section class="plan-hero panel">
        <div class="plan-hero-main">
          <div class="plan-hero-top">
            <el-tag :type="plan.status === 'completed' ? 'success' : 'primary'" effect="plain" disable-transitions>
              {{ plan.status === 'completed' ? '已完成' : '进行中' }}
            </el-tag>
            <span class="plan-range">{{ dateRange }} · {{ plan.days }} 天 · 每天 {{ plan.daily_minutes }} 分钟</span>
          </div>
          <h2 class="plan-goal">{{ plan.goal }}</h2>
          <p class="plan-summary">{{ content.summary }}</p>
          <div class="focus-chips">
            <span class="focus-label">重点</span>
            <el-tag v-for="point in content.focus_points" :key="point" size="small" type="info" effect="plain" disable-transitions>
              {{ point }}
            </el-tag>
          </div>
          <p class="plan-subjects">学科：{{ subjectsText }}</p>
        </div>
        <div class="plan-progress">
          <el-progress
            type="dashboard"
            :percentage="progressPercent"
            :width="132"
            :stroke-width="10"
            :color="progressColor"
          >
            <template #default>
              <div class="progress-value">{{ progressPercent }}%</div>
              <div class="progress-label">任务完成</div>
            </template>
          </el-progress>
          <p class="progress-note">{{ completedTasks }} / {{ totalTasks }} 项 · 剩余 {{ remainingDays }} 天</p>
        </div>
      </section>

      <section class="plan-layout">
        <div class="plan-days">
          <article
            v-for="(day, index) in content.days"
            :key="day.date"
            class="day-panel panel"
            :class="{ today: isToday(day.date), finished: isDayDone(day) }"
          >
            <header class="day-head">
              <div class="day-date">
                <span class="day-index">第 {{ index + 1 }} 天</span>
                <h3>{{ day.date }} <span>{{ day.weekday }}</span></h3>
              </div>
              <div class="day-meta">
                <el-tag size="small" effect="plain" disable-transitions>{{ day.focus }}</el-tag>
                <span><el-icon><Timer /></el-icon>{{ day.minutes }} 分钟</span>
              </div>
            </header>
            <ul class="task-list">
              <li v-for="task in day.tasks" :key="task.task_id" :class="{ done: task.done }">
                <el-checkbox
                  :model-value="task.done"
                  :disabled="savingTask === task.task_id"
                  @change="toggleTask(task)"
                />
                <div class="task-main">
                  <div class="task-title">
                    <el-tag size="small" effect="plain" :type="typeMeta[task.type].type" disable-transitions>
                      {{ typeMeta[task.type].label }}
                    </el-tag>
                    <span>{{ task.title }}</span>
                  </div>
                  <p class="task-detail">{{ task.detail }}</p>
                </div>
              </li>
            </ul>
          </article>
        </div>

        <aside class="plan-side">
          <div class="panel side-panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">计划依据</h2>
                <p class="panel-sub">来自掌握度、到期错题与资料库</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="side-row">
                <span>薄弱知识点</span>
                <b>{{ content.source.weak_points.length }} 个</b>
              </div>
              <div v-if="content.source.weak_points.length" class="weak-list">
                <div v-for="item in content.source.weak_points.slice(0, 5)" :key="item.knowledge_point" class="weak-row">
                  <span class="weak-name">{{ item.knowledge_point }}</span>
                  <span class="numeric">{{ item.probability }}%</span>
                </div>
              </div>
              <div class="side-row">
                <span>到期错题</span>
                <b>{{ content.source.due_wrong }} 道</b>
              </div>
              <div class="side-row">
                <span>已入库资料</span>
                <b>{{ content.source.documents.length }} 份</b>
              </div>
            </div>
          </div>

          <div class="panel side-panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">历史计划</h2>
                <p class="panel-sub">最近归档</p>
              </div>
            </div>
            <div class="panel-body">
              <div v-for="item in overview?.history ?? []" :key="item.plan_id" class="history-item">
                <div>
                  <p class="history-goal">{{ item.goal }}</p>
                  <p class="history-meta">{{ item.start_date }} · {{ item.days }} 天 · {{ Math.round(item.progress * 100) }}%</p>
                </div>
                <span class="history-status">已归档</span>
              </div>
              <p v-if="!(overview?.history ?? []).length" class="inline-empty">还没有归档计划</p>
            </div>
          </div>
        </aside>
      </section>
    </template>

    <section v-else-if="!loading" class="panel empty-panel">
      <el-empty
        description="还没有学习计划。设定目标与每天可投入的时间，系统会结合薄弱点和错题生成每日任务。"
        :image-size="90"
      >
        <el-button type="primary" :icon="Calendar" @click="openCreate">生成学习计划</el-button>
      </el-empty>
      <div class="empty-points">
        <div><el-icon><TrendCharts /></el-icon><span>按掌握度排序薄弱点</span></div>
        <div><el-icon><CircleCheck /></el-icon><span>到期错题自动排入</span></div>
        <div><el-icon><Timer /></el-icon><span>每日任务控制在设定时长内</span></div>
      </div>
    </section>

    <el-dialog
      v-model="dialogOpen"
      :title="editing ? '调整学习计划' : '生成学习计划'"
      width="540px"
      align-center
    >
      <el-form label-position="top">
        <el-form-item label="学习目标">
          <el-input
            v-model="form.goal"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="例如：两周补完函数基础，期末数学提高 15 分"
          />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="计划天数">
            <el-select v-model="form.days">
              <el-option :value="7" label="7 天" />
              <el-option :value="14" label="14 天" />
              <el-option :value="21" label="21 天" />
              <el-option :value="30" label="30 天" />
              <el-option :value="60" label="60 天" />
            </el-select>
          </el-form-item>
          <el-form-item label="每日时长">
            <el-select v-model="form.dailyMinutes">
              <el-option :value="20" label="20 分钟" />
              <el-option :value="30" label="30 分钟" />
              <el-option :value="45" label="45 分钟" />
              <el-option :value="60" label="1 小时" />
              <el-option :value="90" label="1.5 小时" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="涉及学科（可选）">
          <el-input v-model="form.subjects" placeholder="数学、物理（用逗号分隔）" />
        </el-form-item>
        <p class="dialog-note">
          {{ editing ? '调整后会按新参数重新生成每日任务，任务完成状态会重置。' : '生成新计划后，当前计划会自动归档。' }}
        </p>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">
          {{ editing ? '保存调整' : '生成计划' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.plan-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.plan-title {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.plan-sub {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--muted);
}

.plan-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.plan-error {
  margin-bottom: 16px;
}

.plan-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 26px;
  background:
    linear-gradient(120deg, rgba(47, 91, 234, 0.06), rgba(255, 255, 255, 0) 55%),
    #fff;
}

.plan-hero-main {
  min-width: 0;
}

.plan-hero-top {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.plan-range {
  font-size: 11.5px;
  color: var(--faint);
}

.plan-goal {
  margin-top: 10px;
  font-family: var(--font-serif);
  font-size: 25px;
  font-weight: 600;
  line-height: 1.35;
}

.plan-summary {
  margin-top: 6px;
  max-width: 780px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.65;
}

.focus-chips {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.focus-label {
  font-size: 11px;
  color: var(--faint);
}

.plan-subjects {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--faint);
}

.plan-progress {
  flex: none;
  text-align: center;
}

.progress-value {
  font-family: var(--font-serif);
  font-size: 27px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.2;
}

.progress-label {
  margin-top: 1px;
  font-size: 11px;
  color: var(--faint);
}

.progress-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--faint);
}

.plan-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr);
  gap: 18px;
  align-items: start;
  margin-top: 18px;
}

.plan-days {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.day-panel {
  padding: 18px 20px 14px;
}

.day-panel.today {
  border-color: #b9c8f7;
  box-shadow: 0 0 0 3px rgba(47, 91, 234, 0.06);
}

.day-panel.finished {
  border-color: #cfe4d8;
}

.day-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.day-date h3 {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}

.day-date h3 span {
  margin-left: 5px;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--faint);
}

.day-index {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--accent);
}

.day-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--faint);
  flex-wrap: wrap;
}

.day-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.task-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}

.task-list li {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.task-list li:first-child {
  border-top: 0;
}

.task-list li :deep(.el-checkbox) {
  margin-top: 1px;
  height: auto;
}

.task-main {
  min-width: 0;
}

.task-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-soft);
  line-height: 1.5;
}

.task-detail {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.55;
}

.task-list li.done .task-title span:last-child {
  color: var(--faint);
  text-decoration: line-through;
}

.task-list li.done .task-detail {
  opacity: 0.65;
}

.plan-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: sticky;
  top: 18px;
}

.side-panel .panel-body {
  padding-top: 0;
}

.side-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--muted);
}

.side-row b {
  font-weight: 600;
  color: var(--ink-soft);
}

.weak-list {
  padding: 6px 0 2px;
}

.weak-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.weak-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weak-row .numeric {
  color: var(--warning);
  white-space: nowrap;
}

.history-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}

.history-item:last-of-type {
  border-bottom: 0;
}

.history-goal {
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.45;
}

.history-meta {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--faint);
}

.history-status {
  flex: none;
  font-size: 10.5px;
  color: var(--faint);
}

.empty-panel {
  padding: 8px 20px 26px;
}

.empty-points {
  display: flex;
  justify-content: center;
  gap: 28px;
  flex-wrap: wrap;
  padding: 0 20px 18px;
  font-size: 11.5px;
  color: var(--muted);
}

.empty-points div {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-points .el-icon {
  color: var(--accent);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.form-grid :deep(.el-select) {
  width: 100%;
}

.dialog-note {
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.55;
}

@media (max-width: 1100px) {
  .plan-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .plan-side {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .plan-hero {
    flex-direction: column;
    align-items: flex-start;
    padding: 20px;
  }

  .plan-progress {
    align-self: flex-start;
    text-align: left;
  }

  .plan-goal {
    font-size: 21px;
  }

  .plan-side {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .plan-title {
    font-size: 21px;
  }

  .plan-actions {
    width: 100%;
  }

  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .day-panel {
    padding: 16px 16px 12px;
  }

  .empty-points {
    justify-content: flex-start;
    gap: 12px;
  }
}
</style>
