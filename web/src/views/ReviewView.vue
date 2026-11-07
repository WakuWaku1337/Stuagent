<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import {
  DataAnalysis,
  DocumentChecked,
  Refresh,
  TrendCharts,
  UploadFilled,
  Warning,
} from '@element-plus/icons-vue';
import { init, use, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import MetricCard from '../components/MetricCard.vue';
import MarkdownView from '../components/MarkdownView.vue';
import {
  api,
  type CompareResult,
  type ExamDetail,
  type ExamSummary,
} from '../api/data';

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Stats {
  rate: number;
  got: number;
  total: number;
  wrongCount: number;
  byKnowledge: { knowledge_point: string; lost: number; full: number }[];
}

const exams = ref<ExamSummary[]>([]);
const fileList = ref<UploadUserFile[]>([]);
const pasted = ref('');
const recognizing = ref(false);
const loading = ref(false);
const message = ref('');
const detail = ref<ExamDetail | null>(null);
const drawerOpen = ref(false);
const report = ref('');
const stats = ref<Stats | null>(null);
const analyzingId = ref('');
const compare = ref<CompareResult | null>(null);
const chartEl = ref<HTMLElement>();
let chart: ECharts | null = null;
let resizeHandler: (() => void) | null = null;

const examCount = ref(0);
const latestRate = ref<number | null>(null);
const averageRate = ref<number | null>(null);

async function load() {
  loading.value = true;
  try {
    const [list, cmp] = await Promise.all([api.exams(), api.compareExams()]);
    exams.value = list.exams;
    compare.value = cmp;
    examCount.value = cmp.series.length;
    if (cmp.series.length) {
      latestRate.value = cmp.series[cmp.series.length - 1].rate;
      averageRate.value = Math.round(
        cmp.series.reduce((sum, item) => sum + item.rate, 0) / cmp.series.length,
      );
    }
    await nextTick();
    renderChart();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chartEl.value || !compare.value) return;
  chart ??= init(chartEl.value);
  const series = compare.value.series;
  chart.setOption({
    grid: { left: 46, right: 24, top: 26, bottom: 32 },
    xAxis: {
      type: 'category',
      data: series.map((s) => s.date),
      axisLine: { lineStyle: { color: '#dfe4e1' } },
      axisTick: { show: false },
      axisLabel: { color: '#6b7681', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      name: '得分率 %',
      nameTextStyle: { color: '#98a2ab', fontSize: 11 },
      axisLabel: { color: '#98a2ab', fontSize: 11 },
      splitLine: { lineStyle: { color: '#eef1ef' } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#15202b',
      borderWidth: 0,
      textStyle: { color: '#f2f6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; data: number; dataIndex: number }[];
        const item = list[0];
        const point = series[item.dataIndex];
        return `${item.axisValue}<br/>${point.name}<br/>得分率 ${item.data}%（${point.score}/${point.total}）`;
      },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: series.map((s) => s.rate),
        itemStyle: { color: '#2f5bea' },
        lineStyle: { width: 2, color: '#2f5bea' },
        areaStyle: { color: 'rgba(47, 91, 234, 0.08)' },
        label: {
          show: true,
          formatter: '{c}%',
          position: 'top',
          color: '#3b4854',
          fontSize: 11,
        },
      },
    ],
  });
}

function pickFile() {
  return fileList.value[0]?.raw ?? null;
}

async function recognize() {
  recognizing.value = true;
  message.value = '';
  try {
    const file = pickFile();
    let res: Response;
    if (file) {
      const form = new FormData();
      form.append('file', file);
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
    message.value = `识别成功：${data.questions ?? '?'} 道题`;
    ElMessage.success('整卷识别完成');
    pasted.value = '';
    fileList.value = [];
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    recognizing.value = false;
  }
}

async function open(exam: ExamSummary) {
  try {
    detail.value = await api.examDetail(exam.exam_id);
    report.value = detail.value.review?.report ?? '';
    drawerOpen.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function analyze(exam: ExamSummary) {
  analyzingId.value = exam.exam_id;
  message.value = '正在生成复盘报告…';
  try {
    const res = await fetch(`/api/reviews/${exam.exam_id}/analyze`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? '复盘失败');
    report.value = data.report;
    stats.value = data.stats;
    message.value = `复盘完成：失分知识点 ${data.stats.byKnowledge.length} 个，新增错题 ${data.wrongAdded} 道`;
    ElMessage.success('复盘报告已生成');
    await load();
    await open(exam);
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    analyzingId.value = '';
  }
}

function examRate(exam: ExamSummary) {
  if (!exam.my_score || !exam.total_score) return 0;
  return Math.round((exam.my_score / exam.total_score) * 100);
}

function knowledgeRate(item: { lost: number; full: number }) {
  return item.full ? Math.round((item.lost / item.full) * 100) : 0;
}

function fmtDate(date: string | null) {
  return date || '未标注';
}

onMounted(async () => {
  await load();
  resizeHandler = () => chart?.resize();
  window.addEventListener('resize', resizeHandler);
});

onBeforeUnmount(() => {
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div class="page">
    <section class="metric-grid">
      <MetricCard label="考试记录" :value="examCount" suffix="次" :icon="DocumentChecked" tone="accent" hint="已识别并保存的整卷" />
      <MetricCard label="最近得分率" :value="latestRate ?? 0" suffix="%" :icon="TrendCharts" tone="success" :hint="latestRate === null ? '暂无考试数据' : '按最近一次考试计算'" />
      <MetricCard label="平均得分率" :value="averageRate ?? 0" suffix="%" :icon="DataAnalysis" tone="ink" hint="全部考试记录的算术平均" />
      <MetricCard label="薄弱知识点" :value="compare?.weakest.length ?? 0" suffix="个" :icon="Warning" tone="warning" hint="按累计失分统计" />
    </section>

    <section class="section columns">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">成绩趋势</h2>
            <p class="panel-sub">每次考试的得分率变化</p>
          </div>
          <el-button text :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        </div>
        <div class="panel-body">
          <p v-if="compare?.summary" class="trend-summary">{{ compare.summary }}</p>
          <div v-show="compare?.series.length" ref="chartEl" class="trend-chart"></div>
          <el-empty
            v-if="!loading && !compare?.series.length"
            description="暂无考试趋势，上传整卷后自动生成"
            :image-size="80"
          />
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">上传整卷</h2>
            <p class="panel-sub">识别题目、作答、批改痕迹与得分</p>
          </div>
        </div>
        <div class="panel-body">
          <el-upload
            v-model:file-list="fileList"
            drag
            :auto-upload="false"
            :limit="1"
            accept="image/png,image/jpeg,image/webp,.pdf,.docx,.txt,.md"
            class="review-upload"
          >
            <el-icon class="review-upload-icon"><UploadFilled /></el-icon>
            <div class="review-upload-text">拖拽试卷图片或文件到此处</div>
            <div class="review-upload-hint">PNG / JPG / WEBP / PDF / DOCX / TXT / Markdown</div>
          </el-upload>

          <el-input
            v-model="pasted"
            class="review-paste"
            type="textarea"
            :rows="3"
            resize="none"
            placeholder="或直接粘贴试卷文本…"
          />

          <el-button
            type="primary"
            class="review-submit"
            :loading="recognizing"
            :disabled="fileList.length === 0 && !pasted.trim()"
            @click="recognize"
          >
            {{ recognizing ? '正在识别整卷…' : '识别整卷' }}
          </el-button>

          <el-alert
            v-if="message"
            class="review-message"
            :title="message"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
      </div>
    </section>

    <section class="section panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">考试记录</h2>
          <p class="panel-sub">共 {{ exams.length }} 次考试 · 点击「复盘」生成失分分析</p>
        </div>
      </div>
      <div class="panel-body">
        <el-table :data="exams" v-loading="loading">
          <el-table-column prop="name" label="试卷" min-width="180" show-overflow-tooltip />
          <el-table-column label="日期" width="118">
            <template #default="{ row }">{{ fmtDate(row.exam_date) }}</template>
          </el-table-column>
          <el-table-column label="得分" width="96">
            <template #default="{ row }">
              <span class="numeric">{{ row.my_score ?? '-' }}/{{ row.total_score ?? '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="得分率" min-width="150">
            <template #default="{ row }">
              <el-progress
                :percentage="examRate(row as ExamSummary)"
                :stroke-width="6"
                :color="examRate(row as ExamSummary) >= 60 ? '#2c7a5b' : '#c58a3d'"
              />
            </template>
          </el-table-column>
          <el-table-column label="题数" width="70" align="center">
            <template #default="{ row }">{{ row.question_count }}</template>
          </el-table-column>
          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <el-tag size="small" :type="row.reviewed ? 'success' : 'warning'" effect="plain">
                {{ row.reviewed ? '已复盘' : '待复盘' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="open(row as ExamSummary)">查看</el-button>
              <el-button
                link
                type="primary"
                size="small"
                :loading="analyzingId === row.exam_id"
                @click="analyze(row as ExamSummary)"
              >
                复盘
              </el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="还没有考试记录" :image-size="80" />
          </template>
        </el-table>
      </div>
    </section>

    <section v-if="stats" class="section columns">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">本次复盘</h2>
            <p class="panel-sub">得分与失分知识点分布</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="stats-strip">
            <div class="stat-box">
              <span class="stat-box-label">得分率</span>
              <span class="stat-box-value numeric">{{ stats.rate }}%</span>
            </div>
            <div class="stat-box">
              <span class="stat-box-label">得分</span>
              <span class="stat-box-value numeric">{{ stats.got }}/{{ stats.total }}</span>
            </div>
            <div class="stat-box">
              <span class="stat-box-label">错题</span>
              <span class="stat-box-value numeric">{{ stats.wrongCount }}</span>
            </div>
          </div>
          <div class="loss-list">
            <div v-for="item in stats.byKnowledge" :key="item.knowledge_point" class="loss-row">
              <div class="loss-head">
                <span class="loss-name">{{ item.knowledge_point }}</span>
                <span class="loss-value numeric">失 {{ item.lost }} / {{ item.full }} 分</span>
              </div>
              <el-progress
                :percentage="knowledgeRate(item)"
                :stroke-width="6"
                :color="knowledgeRate(item) >= 40 ? '#c58a3d' : '#7f9cff'"
              />
            </div>
            <p v-if="stats.byKnowledge.length === 0" class="inline-empty">本次没有失分知识点。</p>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">复盘报告</h2>
            <p class="panel-sub">由模型根据逐题得分与错因生成</p>
          </div>
        </div>
        <div class="panel-body report-body">
          <MarkdownView v-if="report" :text="report" />
          <el-empty v-else description="生成复盘后在这里查看报告" :image-size="70" />
        </div>
      </div>
    </section>

    <section v-else-if="report" class="section panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">复盘报告</h2>
          <p class="panel-sub">由模型根据逐题得分与错因生成</p>
        </div>
      </div>
      <div class="panel-body report-body">
        <MarkdownView :text="report" />
      </div>
    </section>

    <el-drawer
      v-model="drawerOpen"
      :title="detail?.paper.name ?? '考试详情'"
      size="760px"
      class="review-drawer"
    >
      <div v-if="detail" class="drawer-inner">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="考试日期">{{ fmtDate(detail.paper.exam_date) }}</el-descriptions-item>
          <el-descriptions-item label="得分">
            {{ detail.paper.my_score ?? '-' }} / {{ detail.paper.total_score ?? '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="题数">{{ detail.questions.length }}</el-descriptions-item>
        </el-descriptions>

        <h3 class="drawer-section-title">逐题明细</h3>
        <el-table :data="detail.questions" size="small">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="drawer-expand">
                <MarkdownView v-if="row.content" :text="row.content" />
                <p v-else class="muted">暂无题目原文。</p>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="question_no" label="题号" width="58" />
          <el-table-column prop="knowledge_point" label="知识点" min-width="130" show-overflow-tooltip />
          <el-table-column label="得分" width="76">
            <template #default="{ row }">{{ row.got_score }}/{{ row.full_score }}</template>
          </el-table-column>
          <el-table-column prop="student_answer" label="我的答案" width="94" />
          <el-table-column prop="correct_answer" label="正确答案" width="94" />
          <el-table-column prop="error_reason" label="错因" min-width="130" show-overflow-tooltip />
          <el-table-column label="判定" width="72">
            <template #default="{ row }">
              <el-tag v-if="row.is_correct === 0" size="small" type="danger">错误</el-tag>
              <el-tag v-else-if="row.is_correct === 1" size="small" type="success">正确</el-tag>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.trend-summary {
  margin-bottom: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted);
}

.trend-chart {
  width: 100%;
  height: 300px;
}

.review-upload :deep(.el-upload) {
  width: 100%;
}

.review-upload :deep(.el-upload-dragger) {
  padding: 20px 12px;
  border-radius: 10px;
  border-color: var(--line-strong);
  background: #fafcfb;
}

.review-upload :deep(.el-upload-dragger:hover) {
  border-color: var(--accent);
}

.review-upload-icon {
  font-size: 26px;
  color: var(--faint);
  margin-bottom: 6px;
}

.review-upload-text {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.review-upload-hint {
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--faint);
}

.review-paste {
  margin-top: 12px;
}

.review-submit {
  width: 100%;
  margin-top: 12px;
}

.review-message {
  margin-top: 12px;
}

.stats-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}

.stat-box {
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fafcfb;
}

.stat-box-label {
  display: block;
  font-size: 11.5px;
  color: var(--muted);
}

.stat-box-value {
  display: block;
  margin-top: 2px;
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
}

.loss-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.loss-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
}

.loss-name {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.loss-value {
  font-size: 11.5px;
  color: var(--faint);
}

.report-body {
  max-height: 520px;
  overflow-y: auto;
}

.review-drawer :deep(.el-drawer__body) {
  padding: 20px 24px 28px;
}

.drawer-inner {
  padding-bottom: 20px;
}

.drawer-section-title {
  margin: 22px 0 10px;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
}

.drawer-expand {
  padding: 10px 18px 14px 46px;
  background: #fafcfb;
}

.drawer-expand :deep(.markdown) {
  font-size: 13px;
}

@media (max-width: 900px) {
  .review-drawer {
    width: 100% !important;
  }
}

@media (max-width: 640px) {
  .stats-strip {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>