<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ChatDotRound,
  Collection,
  EditPen,
  Notebook,
  Reading,
  Right,
  Timer,
  TrendCharts,
  UploadFilled,
} from '@element-plus/icons-vue';
import MetricCard from '../components/MetricCard.vue';
import MarkdownView from '../components/MarkdownView.vue';
import { api, type CoursewareItem, type DocumentItem, type ExamSummary, type MasteryItem, type WrongRecord } from '../api/data';

const router = useRouter();

const healthOk = ref<boolean | null>(null);
const modelName = ref('');
const documents = ref<DocumentItem[]>([]);
const mastery = ref<MasteryItem[]>([]);
const wrongRecords = ref<WrongRecord[]>([]);
const dueCount = ref(0);
const exams = ref<ExamSummary[]>([]);
const latestRate = ref<number | null>(null);
const courseware = ref<CoursewareItem[]>([]);
const loading = ref(true);
const loadError = ref('');

const now = new Date();
const today = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 星期${
  ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
}`;

const indexedDocs = computed(() => documents.value.filter((d) => d.status === 'indexed').length);
const chunkTotal = computed(() => documents.value.reduce((sum, d) => sum + d.chunk_count, 0));
const masteredCount = computed(() => mastery.value.filter((m) => m.mastered).length);
const averageMastery = computed(() => {
  if (mastery.value.length === 0) return 0;
  return Math.round(mastery.value.reduce((sum, m) => sum + m.percent, 0) / mastery.value.length);
});
const weakest = computed(() => [...mastery.value].sort((a, b) => a.percent - b.percent).slice(0, 6));
const weakestFirst = computed(() => weakest.value[0]);
const dueWrong = computed(() => [...wrongRecords.value].sort((a, b) => a.next_review - b.next_review).slice(0, 3));
const recentExams = computed(() =>
  [...exams.value]
    .sort((a, b) => (b.exam_date ?? '').localeCompare(a.exam_date ?? ''))
    .slice(0, 5),
);
const recentCourseware = computed(() => [...courseware.value].sort((a, b) => b.created_at - a.created_at).slice(0, 3));

const heroDesc = computed(() => {
  if (loading.value) return '正在汇总本地学习数据…';
  const parts: string[] = [];
  if (dueCount.value > 0) parts.push(`今日有 ${dueCount.value} 道错题到期`);
  if (weakestFirst.value) {
    parts.push(`最需要补的是「${weakestFirst.value.knowledge_point}」，掌握度 ${weakestFirst.value.percent}%`);
  }
  if (parts.length === 0) return '暂无学习记录。上传一份资料或生成一组练习，学习台会自动汇总进度。';
  return `${parts.join('；')}。资料、练习、模考与复盘在同一处管理。`;
});

function progressColor(percent: number) {
  if (percent < 40) return '#c58a3d';
  if (percent < 70) return '#7f9cff';
  return '#5fae8c';
}

function examRate(row: ExamSummary) {
  if (!row.my_score || !row.total_score) return 0;
  return Math.round((row.my_score / row.total_score) * 100);
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

async function load() {
  loading.value = true;
  const results = await Promise.allSettled([
    api.health(),
    api.model(),
    api.documents(),
    api.mastery(),
    api.wrongbook(),
    api.exams(),
    api.compareExams(),
    api.courseware(),
  ]);
  const [health, model, docs, masteryRes, wrongRes, examsRes, compare, cw] = results;

  healthOk.value = health.status === 'fulfilled';
  if (model.status === 'fulfilled' && model.value.configured && model.value.model) {
    modelName.value = model.value.model;
  }
  if (docs.status === 'fulfilled') documents.value = docs.value.documents;
  if (masteryRes.status === 'fulfilled') mastery.value = masteryRes.value.mastery;
  if (wrongRes.status === 'fulfilled') {
    wrongRecords.value = wrongRes.value.records;
    dueCount.value = wrongRes.value.due;
  }
  if (examsRes.status === 'fulfilled') exams.value = examsRes.value.exams;
  if (compare.status === 'fulfilled' && compare.value.series.length > 0) {
    latestRate.value = compare.value.series[compare.value.series.length - 1].rate;
  }
  if (cw.status === 'fulfilled') courseware.value = cw.value.items;

  const failures = results.filter((r) => r.status === 'rejected').length;
  loadError.value = failures >= 4 ? '大部分数据接口未响应，请确认本地服务已启动。' : '';
  loading.value = false;
}

onMounted(load);
</script>

<template>
  <div class="page">
    <section class="hero">
      <div>
        <p class="hero-kicker">{{ today }}</p>
        <h1 class="hero-title">把今天的学习，<br />落在纸面上。</h1>
        <p class="hero-desc">{{ heroDesc }}</p>
        <div class="hero-actions">
          <el-button class="hero-btn" :icon="ChatDotRound" @click="router.push('/chat')">
            开始对话
          </el-button>
          <el-button class="hero-btn-ghost" :icon="Notebook" @click="router.push('/wrongbook')">
            {{ dueCount > 0 ? `复习 ${dueCount} 道错题` : '查看错题本' }}
          </el-button>
        </div>
        <div class="hero-meta">
          <span><strong>{{ indexedDocs }}</strong> 份资料已入库</span>
          <span><strong>{{ mastery.length }}</strong> 个知识点追踪中</span>
          <span><strong>{{ exams.length }}</strong> 次考试已记录</span>
          <span><strong>{{ chunkTotal }}</strong> 个知识切片</span>
        </div>
      </div>
      <div class="hero-meter">
        <el-progress
          type="dashboard"
          :percentage="averageMastery"
          :width="132"
          :stroke-width="8"
          :show-text="false"
          :color="progressColor(averageMastery)"
        />
        <div>
          <p class="hero-meter-label">平均掌握度</p>
          <p class="hero-meter-value numeric">{{ averageMastery }}%</p>
          <p class="hero-meter-note">
            已掌握 {{ masteredCount }} / {{ mastery.length }} 个知识点
          </p>
        </div>
      </div>
    </section>

    <el-alert
      v-if="loadError"
      class="load-alert"
      :title="loadError"
      type="warning"
      :closable="false"
      show-icon
    />

    <section class="section metric-grid">
      <MetricCard
        label="资料库"
        :value="documents.length"
        suffix="份"
        :hint="`${indexedDocs} 份已向量化 · ${chunkTotal} 个切片`"
        :icon="Collection"
        tone="accent"
      />
      <MetricCard
        label="知识点"
        :value="mastery.length"
        suffix="个"
        :hint="`${masteredCount} 个已稳固 · 平均 ${averageMastery}%`"
        :icon="TrendCharts"
        tone="success"
      />
      <MetricCard
        label="待复习错题"
        :value="dueCount"
        suffix="题"
        :hint="`错题本共 ${wrongRecords.length} 题`"
        :icon="Notebook"
        tone="warning"
      />
      <MetricCard
        label="最近得分率"
        :value="latestRate ?? 0"
        suffix="%"
        :hint="exams.length ? `基于 ${exams.length} 次考试记录` : '暂无考试记录'"
        :icon="Timer"
        tone="ink"
      />
    </section>

    <section class="section columns">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">掌握度概览</h2>
            <p class="panel-sub">由低到高排列，优先处理 70% 以下的知识点</p>
          </div>
          <el-button text type="primary" @click="router.push('/mastery')">
            全部<el-icon class="el-icon--right"><Right /></el-icon>
          </el-button>
        </div>
        <div class="panel-body">
          <div v-if="loading" class="inline-empty">正在读取掌握度…</div>
          <template v-else-if="weakest.length">
            <div v-for="item in weakest" :key="item.knowledge_point" class="kp-row">
              <span class="kp-name" :title="item.knowledge_point">{{ item.knowledge_point }}</span>
              <el-progress
                :percentage="item.percent"
                :stroke-width="7"
                :show-text="false"
                :color="progressColor(item.percent)"
              />
              <span class="kp-percent">{{ item.percent }}%</span>
            </div>
          </template>
          <el-empty v-else description="暂无掌握度数据，完成练习后自动生成" :image-size="72" />
        </div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">下一步</h2>
              <p class="panel-sub">按当前数据推荐的学习动作</p>
            </div>
          </div>
          <div class="panel-body action-list">
            <router-link to="/wrongbook" class="action-row">
              <span class="action-icon"><el-icon><Notebook /></el-icon></span>
              <span class="action-main">
                <span class="action-title">复习到期错题</span>
                <span class="action-note">{{ dueCount }} 题待复习 · 按遗忘曲线安排</span>
              </span>
              <el-icon class="action-arrow"><Right /></el-icon>
            </router-link>
            <router-link to="/mastery" class="action-row">
              <span class="action-icon"><el-icon><TrendCharts /></el-icon></span>
              <span class="action-main">
                <span class="action-title">巩固薄弱知识点</span>
                <span class="action-note">
                  {{ weakestFirst ? `${weakestFirst.knowledge_point} · ${weakestFirst.percent}%` : '等待练习数据' }}
                </span>
              </span>
              <el-icon class="action-arrow"><Right /></el-icon>
            </router-link>
            <router-link to="/quiz" class="action-row">
              <span class="action-icon"><el-icon><EditPen /></el-icon></span>
              <span class="action-main">
                <span class="action-title">生成一组练习</span>
                <span class="action-note">按知识点出题，提交后即时判分</span>
              </span>
              <el-icon class="action-arrow"><Right /></el-icon>
            </router-link>
            <router-link to="/documents" class="action-row">
              <span class="action-icon"><el-icon><UploadFilled /></el-icon></span>
              <span class="action-main">
                <span class="action-title">补充学习资料</span>
                <span class="action-note">支持 PDF / Word / TXT / Markdown</span>
              </span>
              <el-icon class="action-arrow"><Right /></el-icon>
            </router-link>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">最近课件</h2>
              <p class="panel-sub">{{ recentCourseware.length ? '生成后可离线打开' : '尚未生成交互课件' }}</p>
            </div>
            <el-button text type="primary" @click="router.push('/courseware')">课件库</el-button>
          </div>
          <div class="panel-body mini-list">
            <router-link
              v-for="item in recentCourseware"
              :key="item.courseware_id"
              :to="`/courseware?open=${item.courseware_id}`"
              class="mini-row"
            >
              <span class="action-icon"><el-icon><Reading /></el-icon></span>
              <span class="action-main">
                <span class="action-title">{{ item.title }}</span>
                <span class="action-note">{{ item.subject ?? '未分科' }} · {{ item.source === 'llm' ? '模型生成' : '内置模板' }}</span>
              </span>
              <el-icon class="action-arrow"><Right /></el-icon>
            </router-link>
            <p v-if="!recentCourseware.length" class="inline-empty">暂无课件，可在交互课件页生成</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section columns-even">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">最近考试</h2>
            <p class="panel-sub">得分率按每次考试的得分与总分计算</p>
          </div>
          <el-button text type="primary" @click="router.push('/review')">考试复盘</el-button>
        </div>
        <div class="panel-body">
          <el-table v-if="recentExams.length" :data="recentExams" size="small">
            <el-table-column prop="name" label="试卷" min-width="150" show-overflow-tooltip />
            <el-table-column prop="exam_date" label="日期" width="106" />
            <el-table-column label="得分" width="86">
              <template #default="{ row }">
                <span class="numeric">{{ row.my_score ?? '-' }}/{{ row.total_score ?? '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="得分率" min-width="130">
              <template #default="{ row }">
                <el-progress
                  :percentage="examRate(row as ExamSummary)"
                  :stroke-width="6"
                  :color="progressColor(examRate(row as ExamSummary))"
                />
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无考试记录" :image-size="72" />
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">待复习队列</h2>
            <p class="panel-sub">按下次复习日期排序</p>
          </div>
          <el-button text type="primary" @click="router.push('/wrongbook')">错题本</el-button>
        </div>
        <div class="panel-body">
          <template v-if="dueWrong.length">
            <div v-for="record in dueWrong" :key="record.record_id" class="wrong-row">
              <div class="wrong-head">
                <el-tag size="small" effect="plain">{{ record.question_snapshot.knowledge_point ?? '未标注' }}</el-tag>
                <span class="wrong-date">下次 {{ fmtDate(record.next_review) }}</span>
              </div>
              <div class="wrong-stem">
                <MarkdownView :text="record.question_snapshot.content" />
              </div>
              <p class="wrong-reason">错因：{{ record.reason ?? '未记录' }}</p>
            </div>
          </template>
          <el-empty v-else description="暂无错题，答错的题会自动收录" :image-size="72" />
        </div>
      </div>
    </section>

    <p class="home-foot">
      本地服务{{ healthOk === false ? '未连接' : '在线' }}<template v-if="modelName"> · 模型 {{ modelName }}</template>
      · 所有学习数据保存在本机
    </p>
  </div>
</template>

<style scoped>
.load-alert {
  margin-top: 18px;
}

.hero-meter-note {
  margin-top: 4px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.42);
}

.hero :deep(.el-progress-circle__track) {
  stroke: rgba(255, 255, 255, 0.12);
}

.action-list,
.mini-list {
  padding-top: 4px;
}

.mini-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin: 0 -12px;
  border-radius: 9px;
  color: var(--ink);
}

.mini-row:hover {
  background: var(--paper);
}

.wrong-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}

.wrong-row:first-child {
  padding-top: 2px;
}

.wrong-row:last-child {
  border-bottom: 0;
  padding-bottom: 2px;
}

.wrong-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wrong-date {
  font-size: 11.5px;
  color: var(--faint);
  white-space: nowrap;
}

.wrong-stem {
  margin-top: 7px;
  font-size: 13px;
  max-height: 48px;
  overflow: hidden;
}

.wrong-stem :deep(.markdown) {
  font-size: 13px;
  line-height: 1.55;
}

.wrong-reason {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--faint);
}

.home-foot {
  margin-top: 30px;
  font-size: 11.5px;
  color: var(--faint);
  text-align: center;
}

@media (max-width: 640px) {
  .hero-meter {
    gap: 16px;
  }

  .hero-meter .el-progress {
    width: 104px;
  }
}
</style>
