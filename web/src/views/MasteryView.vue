<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { DataAnalysis, EditPen, Medal, TrendCharts } from '@element-plus/icons-vue';
import MetricCard from '../components/MetricCard.vue';
import { api, type MasteryItem } from '../api/data';

const router = useRouter();
const items = ref<MasteryItem[]>([]);
const loading = ref(false);
const message = ref('');

const sorted = computed(() => [...items.value].sort((a, b) => a.percent - b.percent));
const average = computed(() => {
  if (items.value.length === 0) return 0;
  return Math.round(items.value.reduce((sum, item) => sum + item.percent, 0) / items.value.length);
});
const masteredCount = computed(() => items.value.filter((item) => item.mastered).length);
const weakCount = computed(() => items.value.filter((item) => item.percent < 70).length);
const attemptTotal = computed(() =>
  items.value.reduce((sum, item) => sum + item.correct_count + item.wrong_count, 0),
);
const priority = computed(() => sorted.value.slice(0, 4));

const distribution = computed(() => {
  const total = items.value.length || 1;
  const bands = [
    { label: '已稳固', note: '≥ 95%', min: 95, max: 101, color: 'var(--success)' },
    { label: '基本掌握', note: '70% – 95%', min: 70, max: 95, color: '#5fae8c' },
    { label: '薄弱', note: '40% – 70%', min: 40, max: 70, color: '#c58a3d' },
    { label: '急需补强', note: '< 40%', min: 0, max: 40, color: '#b4443c' },
  ];
  return bands.map((band) => {
    const count = items.value.filter(
      (item) => item.percent >= band.min && item.percent < band.max,
    ).length;
    return { ...band, count, ratio: Math.round((count / total) * 100) };
  });
});

function progressColor(percent: number) {
  if (percent < 40) return '#b4443c';
  if (percent < 70) return '#c58a3d';
  if (percent < 95) return '#5fae8c';
  return '#2c7a5b';
}

function statusText(item: MasteryItem) {
  return item.mastered ? '已掌握' : item.percent >= 70 ? '基本掌握' : '需巩固';
}

function statusType(item: MasteryItem) {
  return item.mastered ? 'success' : item.percent >= 70 ? 'info' : 'warning';
}

function practice(item?: MasteryItem) {
  router.push(item ? { path: '/quiz', query: { kp: item.knowledge_point } } : '/quiz');
}

async function load() {
  loading.value = true;
  try {
    const data = await api.mastery();
    items.value = data.mastery;
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <section class="metric-grid">
      <MetricCard
        label="平均掌握度"
        :value="average"
        suffix="%"
        :icon="TrendCharts"
        tone="accent"
        :hint="`${items.length} 个知识点，按 BKT 概率计算`"
      />
      <MetricCard
        label="已掌握"
        :value="masteredCount"
        suffix="个"
        :icon="Medal"
        tone="success"
        :hint="items.length ? `占比 ${Math.round((masteredCount / items.length) * 100)}%` : '暂无数据'"
      />
      <MetricCard
        label="需巩固"
        :value="weakCount"
        suffix="个"
        :icon="DataAnalysis"
        tone="warning"
        hint="掌握度低于 70%"
      />
      <MetricCard
        label="累计作答"
        :value="attemptTotal"
        suffix="题"
        :icon="EditPen"
        tone="ink"
        hint="练习与模考的作答记录"
      />
    </section>

    <el-alert
      v-if="message"
      class="mastery-alert"
      :title="message"
      type="warning"
      :closable="false"
      show-icon
    />

    <section class="section columns">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">掌握度总览</h2>
            <p class="panel-sub">以 95% 作为掌握阈值，按概率区间统计</p>
          </div>
        </div>
        <div class="panel-body">
          <div v-if="items.length" class="overview">
            <div class="overview-ring">
              <el-progress
                type="dashboard"
                :percentage="average"
                :width="164"
                :stroke-width="10"
                :color="progressColor(average)"
              />
              <p class="ring-label">平均掌握度</p>
            </div>
            <div class="distribution">
              <div v-for="band in distribution" :key="band.label" class="band">
                <div class="band-head">
                  <span class="band-label">{{ band.label }}</span>
                  <span class="band-note">{{ band.note }}</span>
                  <span class="band-count numeric">{{ band.count }} 个</span>
                </div>
                <el-progress
                  :percentage="band.ratio"
                  :stroke-width="6"
                  :show-text="false"
                  :color="band.color"
                />
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无掌握度数据，完成练习后自动生成" :image-size="80" />
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">优先巩固</h2>
            <p class="panel-sub">掌握度由低到高，建议先补前 4 项</p>
          </div>
          <el-button text type="primary" :icon="EditPen" @click="practice()">去练习</el-button>
        </div>
        <div class="panel-body">
          <template v-if="priority.length">
            <div v-for="item in priority" :key="item.knowledge_point" class="priority-row">
              <div class="priority-main">
                <span class="priority-name" :title="item.knowledge_point">{{ item.knowledge_point }}</span>
                <el-progress
                  :percentage="item.percent"
                  :stroke-width="6"
                  :show-text="false"
                  :color="progressColor(item.percent)"
                />
              </div>
              <span class="priority-percent numeric">{{ item.percent }}%</span>
              <el-button size="small" text type="primary" @click="practice(item)">练习</el-button>
            </div>
          </template>
          <el-empty v-else description="暂无薄弱项" :image-size="70" />
        </div>
      </div>
    </section>

    <section class="section panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">全部知识点</h2>
          <p class="panel-sub">按掌握度升序排列 · 共 {{ items.length }} 个</p>
        </div>
        <el-button text :loading="loading" @click="load">刷新</el-button>
      </div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="sorted">
          <el-table-column label="知识点" min-width="230">
            <template #default="{ row }">
              <span class="table-kp">{{ row.knowledge_point }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="108">
            <template #default="{ row }">
              <el-tag size="small" :type="statusType(row as MasteryItem)">{{ statusText(row as MasteryItem) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="掌握度" min-width="260">
            <template #default="{ row }">
              <div class="table-progress">
                <el-progress
                  :percentage="row.percent"
                  :stroke-width="8"
                  :color="progressColor(row.percent)"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column label="作答" width="150">
            <template #default="{ row }">
              <span class="muted">对 {{ row.correct_count }} · 错 {{ row.wrong_count }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="practice(row as MasteryItem)">
                去练习
              </el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无掌握度数据" :image-size="80" />
          </template>
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mastery-alert {
  margin-top: 16px;
}

.overview {
  display: flex;
  align-items: center;
  gap: 40px;
  flex-wrap: wrap;
  padding: 8px 0 4px;
}

.overview-ring {
  flex: none;
  text-align: center;
}

.ring-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.distribution {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.band-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 5px;
}

.band-label {
  font-size: 13px;
  color: var(--ink-soft);
}

.band-note {
  font-size: 11px;
  color: var(--faint);
}

.band-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}

.priority-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}

.priority-row:last-child {
  border-bottom: 0;
}

.priority-main {
  flex: 1;
  min-width: 0;
}

.priority-name {
  display: block;
  margin-bottom: 5px;
  font-size: 13px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.priority-percent {
  flex: none;
  width: 52px;
  text-align: right;
  font-size: 12.5px;
}

.table-kp {
  color: var(--ink);
}

.table-progress {
  max-width: 320px;
}

@media (max-width: 1100px) {
  .overview {
    gap: 26px;
  }
}
</style>