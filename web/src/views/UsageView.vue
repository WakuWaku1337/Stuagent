<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  CircleCheck,
  Coin,
  DataLine,
  Download,
  Refresh,
  Timer,
  TrendCharts,
  Wallet,
} from '@element-plus/icons-vue';
import { init, use, type ECharts } from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import MetricCard from '../components/MetricCard.vue';
import { api, type UsageDaily, type UsageSummary } from '../api/data';

use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const days = ref(30);
const metric = ref<'tokens' | 'cost' | 'calls' | 'latency' | 'success'>('tokens');
const summary = ref<UsageSummary | null>(null);
const daily = ref<UsageDaily[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const trendEl = ref<HTMLElement>();
const pieEl = ref<HTMLElement>();
let trendChart: ECharts | null = null;
let pieChart: ECharts | null = null;
let resizeHandler: (() => void) | null = null;

const hasData = computed(() => (summary.value?.summary.calls ?? 0) > 0);
const budget = computed(() => summary.value?.budget ?? null);
const sceneLabels: Record<string, string> = {
  chat: '答疑对话',
  quiz: '出题与题库',
  review: '考试复盘',
  courseware: '交互课件',
  vision: '图片识别',
  routing: '智能路由',
  test: '连接测试',
};

const metricOptions = [
  { label: 'Token', value: 'tokens' },
  { label: '成本', value: 'cost' },
  { label: '调用', value: 'calls' },
  { label: '延迟', value: 'latency' },
  { label: '成功率', value: 'success' },
];

const palette = ['#2f5bea', '#5fae8c', '#c58a3d', '#7f9cff', '#b4443c', '#69747f'];

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [summaryData, dailyData] = await Promise.all([
      api.usageSummary(days.value),
      api.usageDaily(days.value),
    ]);
    summary.value = summaryData;
    daily.value = dailyData.daily;
    await nextTick();
    renderCharts();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function renderCharts() {
  if (!trendEl.value || !pieEl.value || !summary.value) return;
  trendChart ??= init(trendEl.value);
  pieChart ??= init(pieEl.value);
  const dates = daily.value.map((row) => row.date.slice(5));
  const valueOf = (row: UsageDaily) =>
    metric.value === 'tokens'
      ? row.tokens
      : metric.value === 'cost'
        ? Number(row.cost.toFixed(4))
        : metric.value === 'calls'
          ? row.calls
          : metric.value === 'success'
            ? row.successRate
            : row.avgLatencyMs;
  const name =
    metric.value === 'tokens'
      ? 'Token'
      : metric.value === 'cost'
        ? '成本（USD）'
        : metric.value === 'calls'
          ? '调用次数'
          : metric.value === 'success'
            ? '成功率（%）'
            : '平均延迟（ms）';
  trendChart.setOption(
    {
      grid: { left: 54, right: 22, top: 24, bottom: 34 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#15202b',
        borderWidth: 0,
        textStyle: { color: '#f2f6f4', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#dfe4e1' } },
        axisTick: { show: false },
        axisLabel: { color: '#6b7681', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#98a2ab', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef1ef' } },
        name,
        nameTextStyle: { color: '#98a2ab', fontSize: 11 },
      },
      series: [
        {
          name,
          type: metric.value === 'calls' ? 'bar' : 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          barMaxWidth: 26,
          data: daily.value.map(valueOf),
          itemStyle: { color: '#2f5bea', borderRadius: metric.value === 'calls' ? [4, 4, 0, 0] : 0 },
          lineStyle: { width: 2, color: '#2f5bea' },
          areaStyle:
            metric.value === 'calls'
              ? undefined
              : { color: 'rgba(47, 91, 234, 0.08)' },
        },
      ],
    },
    true,
  );

  const models = summary.value.byModel;
  pieChart.setOption(
    {
      color: palette,
      tooltip: {
        trigger: 'item',
        backgroundColor: '#15202b',
        borderWidth: 0,
        textStyle: { color: '#f2f6f4', fontSize: 12 },
        formatter: '{b}<br/>{c} 次 · {d}%',
      },
      legend: {
        bottom: 0,
        left: 'center',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#6b7681', fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '72%'],
          center: ['50%', '43%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 3 },
          label: { show: false },
          data: models.map((row) => ({ name: row.label, value: row.calls })),
        },
      ],
    },
    true,
  );
}

function onRangeChange() {
  void load();
}

function exportUsage(format: 'csv' | 'json') {
  window.open(`/api/usage/export?days=${days.value}&format=${format}`, '_blank');
}

function formatCost(value: number) {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
}

function sceneLabel(value: string) {
  return sceneLabels[value] ?? value;
}

onMounted(async () => {
  await load();
  resizeHandler = () => {
    trendChart?.resize();
    pieChart?.resize();
  };
  window.addEventListener('resize', resizeHandler);
});

onBeforeUnmount(() => {
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  trendChart?.dispose();
  pieChart?.dispose();
  trendChart = null;
  pieChart = null;
});
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="usage-toolbar">
      <div>
        <h1 class="usage-title">用量与成本</h1>
        <p class="usage-sub">统计模型调用的 Token、成本、成功率与延迟，数据仅保存在本机。</p>
      </div>
      <div class="usage-actions">
        <el-segmented v-model="days" :options="[
          { label: '近 7 天', value: 7 },
          { label: '近 30 天', value: 30 },
          { label: '近 90 天', value: 90 },
        ]" @change="onRangeChange" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button :icon="Download" @click="exportUsage('csv')">CSV</el-button>
        <el-button :icon="Download" @click="exportUsage('json')">JSON</el-button>
      </div>
    </div>

    <el-alert
      v-if="errorMessage"
      class="usage-error"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
    />

    <section class="metric-grid usage-metrics">
      <MetricCard label="调用次数" :value="summary?.summary.calls ?? 0" suffix="次" :icon="DataLine" tone="accent" :hint="`成功 ${summary?.summary.successCalls ?? 0} 次`" />
      <MetricCard label="总 Token" :value="summary?.summary.totalTokens ?? 0" suffix="tokens" :icon="TrendCharts" tone="ink" :hint="`推理 ${summary?.summary.reasoningTokens ?? 0} tokens`" />
      <MetricCard label="估算成本" :value="formatCost(summary?.summary.cost ?? 0)" :icon="Coin" tone="warning" hint="按目录价格估算（USD）" />
      <MetricCard label="成功率" :value="summary?.summary.successRate ?? 0" suffix="%" :icon="CircleCheck" tone="success" :hint="`失败 ${summary?.summary.failedCalls ?? 0} 次`" />
      <MetricCard label="平均延迟" :value="summary?.summary.avgLatencyMs ?? 0" suffix="ms" :icon="Timer" tone="ink" :hint="`P95 ${summary?.summary.p95LatencyMs ?? 0}ms`" />
    </section>

    <section v-if="budget?.monthlyBudget" class="budget-band" :class="{ warning: budget.warning }">
      <span class="budget-icon"><el-icon><Wallet /></el-icon></span>
      <div class="budget-main">
        <div class="budget-head">
          <span class="budget-title">本月预算</span>
          <span class="budget-value numeric">{{ formatCost(budget.monthCost) }} / {{ formatCost(budget.monthlyBudget) }}</span>
        </div>
        <el-progress
          :percentage="budget.percent"
          :stroke-width="8"
          :color="budget.warning ? '#b4443c' : '#2f5bea'"
        />
      </div>
      <el-tag v-if="budget.warning" type="danger" effect="plain">接近阈值</el-tag>
      <span v-else class="budget-note">预算在模型设置中调整</span>
    </section>
    <section v-else class="budget-band budget-empty">
      <span class="budget-icon"><el-icon><Wallet /></el-icon></span>
      <div class="budget-main">
        <span class="budget-title">尚未设置月度预算</span>
        <p class="budget-note">在模型设置中可以配置预算与阈值提醒。</p>
      </div>
      <router-link to="/settings" class="budget-link">去设置</router-link>
    </section>

    <template v-if="hasData">
      <section class="section usage-charts">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">用量趋势</h2>
              <p class="panel-sub">按天聚合，切换指标查看不同维度</p>
            </div>
            <el-segmented v-model="metric" :options="metricOptions" size="small" @change="renderCharts" />
          </div>
          <div class="panel-body">
            <div ref="trendEl" class="trend-chart"></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">模型分布</h2>
              <p class="panel-sub">按调用次数统计</p>
            </div>
          </div>
          <div class="panel-body">
            <div ref="pieEl" class="pie-chart"></div>
          </div>
        </div>
      </section>

      <section class="section usage-breakdown">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">按模型</h2>
              <p class="panel-sub">成本与延迟</p>
            </div>
          </div>
          <div class="panel-body">
            <el-table :data="summary?.byModel ?? []" size="small">
              <el-table-column prop="label" label="模型" min-width="150" show-overflow-tooltip />
              <el-table-column label="调用" width="72" align="right">
                <template #default="{ row }">{{ row.calls }}</template>
              </el-table-column>
              <el-table-column label="成本" width="88" align="right">
                <template #default="{ row }">
                  <span class="numeric">{{ formatCost(row.cost) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="平均延迟" width="96" align="right">
                <template #default="{ row }">
                  <span class="numeric">{{ row.avgLatencyMs }}ms</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">按场景</h2>
              <p class="panel-sub">调用占比</p>
            </div>
          </div>
          <div class="panel-body">
            <div v-for="row in summary?.byScenario ?? []" :key="row.label" class="scene-row">
              <div class="scene-head">
                <span>{{ sceneLabel(row.label) }}</span>
                <span class="numeric">{{ row.calls }} 次</span>
              </div>
              <el-progress
                :percentage="summary?.summary.calls ? Math.round((row.calls / summary.summary.calls) * 100) : 0"
                :stroke-width="6"
                :show-text="false"
              />
            </div>
            <p v-if="!summary?.byScenario.length" class="inline-empty">暂无场景数据</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">按学科</h2>
              <p class="panel-sub">Token 消耗</p>
            </div>
          </div>
          <div class="panel-body">
            <div v-for="row in summary?.bySubject ?? []" :key="row.label" class="subject-row">
              <span class="subject-name">{{ row.label }}</span>
              <span class="subject-tokens numeric">{{ row.tokens.toLocaleString() }}</span>
            </div>
            <p v-if="!summary?.bySubject.length" class="inline-empty">暂无学科数据</p>
          </div>
        </div>
      </section>

      <section class="section panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">每日明细</h2>
            <p class="panel-sub">近 {{ days }} 天，共 {{ daily.length }} 天有调用</p>
          </div>
          <span class="usage-currency">成本单位：USD</span>
        </div>
        <div class="panel-body">
          <el-table :data="[...daily].reverse()" max-height="420" size="small">
            <el-table-column prop="date" label="日期" width="118" />
            <el-table-column label="调用" width="86" align="right">
              <template #default="{ row }">{{ row.calls }}</template>
            </el-table-column>
            <el-table-column label="Token" min-width="110" align="right">
              <template #default="{ row }">
                <span class="numeric">{{ row.tokens.toLocaleString() }}</span>
              </template>
            </el-table-column>
            <el-table-column label="成本" width="100" align="right">
              <template #default="{ row }">
                <span class="numeric">{{ formatCost(row.cost) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="成功率" width="96" align="right">
              <template #default="{ row }">
                <span class="numeric">{{ row.successRate }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="平均延迟" width="108" align="right">
              <template #default="{ row }">
                <span class="numeric">{{ row.avgLatencyMs }}ms</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </template>

    <section v-else-if="!loading" class="section panel">
      <div class="panel-body">
        <el-empty description="还没有用量记录。发起一次对话、出题或复盘后，这里会自动统计 Token、成本与延迟。" :image-size="90">
          <el-button type="primary" @click="$router.push('/chat')">开始对话</el-button>
        </el-empty>
      </div>
    </section>
  </div>
</template>

<style scoped>
.usage-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.usage-title {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.usage-sub {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--muted);
}

.usage-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.usage-error {
  margin-bottom: 16px;
}

.usage-metrics {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.budget-band {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
  padding: 15px 20px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  flex-wrap: wrap;
}

.budget-band.warning {
  border-color: #e9c7c4;
}

.budget-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 17px;
  flex: none;
}

.budget-main {
  flex: 1;
  min-width: 260px;
}

.budget-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.budget-title {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.budget-value {
  font-size: 12.5px;
  color: var(--muted);
}

.budget-note {
  font-size: 11.5px;
  color: var(--faint);
}

.budget-empty .budget-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.budget-link {
  font-size: 12.5px;
  color: var(--accent);
}

.usage-charts {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr);
  gap: 18px;
  align-items: start;
}

.trend-chart {
  height: 300px;
}

.pie-chart {
  height: 300px;
}

.usage-breakdown {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  align-items: start;
}

.scene-row {
  padding: 7px 0;
}

.scene-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--ink-soft);
}

.subject-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}

.subject-row:last-child {
  border-bottom: 0;
}

.subject-name {
  color: var(--ink-soft);
}

.subject-tokens {
  color: var(--muted);
  font-size: 11.5px;
}

.usage-currency {
  font-size: 11px;
  color: var(--faint);
}

@media (max-width: 1280px) {
  .usage-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1100px) {
  .usage-charts,
  .usage-breakdown {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .usage-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .usage-title {
    font-size: 21px;
  }

  .usage-actions {
    width: 100%;
  }

  .usage-charts .panel-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .usage-charts .el-segmented {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>