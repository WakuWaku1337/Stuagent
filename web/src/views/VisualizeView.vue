<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Delete, MagicStick, Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import VizRenderer from '../components/VizRenderer.vue';
import {
  createVisualization,
  deleteVisualization,
  fetchVisualizations,
  generateVisualization,
  type Visualization,
  type VisualizationType,
} from '../api/visualize';
import { typeLabel } from '../utils/visualize';

const route = useRoute();
const items = ref<Visualization[]>([]);
const selectedId = ref('');
const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
const errorMessage = ref('');
const dialogOpen = ref(false);
const question = ref('');
const subject = ref('数学');
const form = reactive({
  type: 'function2d' as VisualizationType,
  title: '',
  expression: 'x^2 - 4',
  rangeMin: -10,
  rangeMax: 10,
  specText: '',
});

const selected = computed(() => items.value.find((item) => item.visualization_id === selectedId.value) ?? null);
const isFunctionForm = computed(() => ['function2d', 'function3d', 'conic'].includes(form.type));

const typeOptions: { value: VisualizationType; label: string }[] = [
  { value: 'function2d', label: '函数图像（2D）' },
  { value: 'geometry3d', label: '立体几何（3D）' },
  { value: 'function3d', label: '三维函数' },
  { value: 'conic', label: '圆锥曲线' },
  { value: 'molecule', label: '化学分子' },
  { value: 'terrain', label: '地理地形' },
  { value: 'biology', label: '生物结构' },
  { value: 'physics', label: '物理图示' },
  { value: 'diagram', label: '通用示意图' },
];

const cubeSpec = JSON.stringify(
  {
    points: [
      { id: 'A', coord: [0, 0, 0] },
      { id: 'B', coord: [1, 0, 0] },
      { id: 'C', coord: [1, 1, 0] },
      { id: 'D', coord: [0, 1, 0] },
      { id: 'E', coord: [0, 0, 1] },
      { id: 'F', coord: [1, 0, 1] },
      { id: 'G', coord: [1, 1, 1] },
      { id: 'H', coord: [0, 1, 1] },
    ],
    edges: [
      ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'],
      ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'E'],
      ['A', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H'],
    ],
    faces: [
      ['A', 'B', 'C', 'D'], ['E', 'F', 'G', 'H'],
      ['A', 'B', 'F', 'E'], ['B', 'C', 'G', 'F'],
      ['C', 'D', 'H', 'G'], ['D', 'A', 'E', 'H'],
    ],
  },
  null,
  2,
);

function syncSpecText() {
  if (isFunctionForm.value) return;
  if (form.type === 'geometry3d') {
    form.specText = cubeSpec;
  } else if (!form.specText.trim()) {
    form.specText = JSON.stringify({ description: '请补充可视化规格', elements: [] }, null, 2);
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await fetchVisualizations();
    items.value = data.visualizations;
    const fromQuery =
      (typeof route.query.id === 'string' ? route.query.id : '') ||
      (typeof route.query.open === 'string' ? route.query.open : '');
    if (fromQuery && items.value.some((item) => item.visualization_id === fromQuery)) {
      selectedId.value = fromQuery;
    } else if (!selectedId.value && items.value.length > 0) {
      selectedId.value = items.value[0].visualization_id;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function openCreate(type: VisualizationType = 'function2d') {
  form.type = type;
  form.title = type === 'geometry3d' ? '正方体与截面' : '函数图像';
  form.expression = 'x^2 - 4';
  form.rangeMin = -10;
  form.rangeMax = 10;
  form.specText = type === 'geometry3d' ? cubeSpec : '';
  syncSpecText();
  dialogOpen.value = true;
}

async function submit() {
  if (!form.title.trim()) {
    ElMessage.warning('请填写标题');
    return;
  }
  let spec: Record<string, unknown>;
  if (isFunctionForm.value) {
    if (!form.expression.trim()) {
      ElMessage.warning('请填写函数表达式');
      return;
    }
    if (!(form.rangeMin < form.rangeMax)) {
      ElMessage.warning('区间最小值必须小于最大值');
      return;
    }
    spec = {
      expression: form.expression.trim(),
      variable: 'x',
      range: [form.rangeMin, form.rangeMax],
    };
  } else {
    try {
      const parsed = JSON.parse(form.specText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('spec 必须是对象');
      spec = parsed as Record<string, unknown>;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : 'spec JSON 格式错误');
      return;
    }
  }
  saving.value = true;
  try {
    const result = await createVisualization({ type: form.type, title: form.title.trim(), spec });
    items.value = [result.visualization, ...items.value];
    selectedId.value = result.visualization.visualization_id;
    dialogOpen.value = false;
    ElMessage.success('可视化已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function generate() {
  const text = question.value.trim();
  if (!text) {
    ElMessage.warning('请输入题目或主题');
    return;
  }
  generating.value = true;
  errorMessage.value = '';
  try {
    const result = await generateVisualization({ question: text, subject: subject.value });
    if (!result.visualization) {
      ElMessage.info('未从题目中解析到可建模的图形结构，请补充方程、点、尺寸或场景信息');
      return;
    }
    items.value = [result.visualization, ...items.value];
    selectedId.value = result.visualization.visualization_id;
    ElMessage.success(
      result.matched === 'preset'
        ? '命中预置模板'
        : result.basis
          ? `已按题目建模：${result.basis}`
          : '已按题目建模',
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    generating.value = false;
  }
}

async function remove(item: Visualization) {
  try {
    await ElMessageBox.confirm(`删除可视化「${item.title}」？`, '删除可视化', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await deleteVisualization(item.visualization_id);
    items.value = items.value.filter((entry) => entry.visualization_id !== item.visualization_id);
    if (selectedId.value === item.visualization_id) selectedId.value = items.value[0]?.visualization_id ?? '';
    ElMessage.success('已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

onMounted(load);
</script>

<template>
  <div class="page viz-page" v-loading="loading">
    <header class="viz-head">
      <div>
        <h1 class="viz-title">统一可视化</h1>
        <p class="viz-sub">按题目内容本地解析并建模：函数、方程、几何点与尺寸、分子式、物理场景直接转成可视化，不调用对话模型生成图。</p>
      </div>
      <div class="viz-actions">
        <el-button :icon="MagicStick" @click="openCreate('function2d')">函数图像</el-button>
        <el-button :icon="MagicStick" @click="openCreate('geometry3d')">立体几何</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate()">手动新建</el-button>
      </div>
    </header>

    <section class="panel viz-generate">
      <div class="viz-generate-row">
        <el-input
          v-model="question"
          placeholder="输入题目或主题，例如：y=x^2-4x+3 的图像 / 正方体过 A、C、E 的截面 / 打印机进纸受力"
          maxlength="2000"
          clearable
          @keyup.enter="generate"
        />
        <el-select v-model="subject" class="viz-subject">
          <el-option v-for="option in ['数学', '物理', '化学', '生物', '地理']" :key="option" :value="option" :label="option" />
        </el-select>
        <el-button type="primary" :icon="MagicStick" :loading="generating" @click="generate">生成可视化</el-button>
      </div>
      <p class="viz-generate-note">解析题目中的表达式、点、尺寸与场景后本地建模；题目没有足够结构时不出图，避免给一张无关的示意图。</p>
    </section>

    <el-alert
      v-if="errorMessage"
      class="viz-error"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
    />

    <section class="viz-layout">
      <div class="panel viz-list-panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">已生成</h2>
            <p class="panel-sub">最近 {{ items.length }} 个</p>
          </div>
        </div>
        <div class="panel-body viz-list">
          <button
            v-for="item in items"
            :key="item.visualization_id"
            type="button"
            class="viz-item"
            :class="{ active: selectedId === item.visualization_id }"
            @click="selectedId = item.visualization_id"
          >
            <span class="viz-item-main">
              <span class="viz-item-title">{{ item.title }}</span>
              <span class="viz-item-meta">{{ typeLabel(item.type) }} · {{ item.kind === 'preset' ? '预置' : item.kind === 'legacy' ? '旧版' : item.source === 'modeler' ? '题目建模' : '生成' }} · {{ new Date(item.created_at).toLocaleDateString('zh-CN') }}</span>
            </span>
            <el-button
              text
              size="small"
              type="danger"
              :icon="Delete"
              @click.stop="remove(item)"
            />
          </button>
          <p v-if="!items.length" class="viz-empty">还没有可视化，点击右上角新建，或让智能体在对话中生成。</p>
        </div>
      </div>

      <div class="panel viz-viewer">
        <div v-if="selected" class="panel-body">
          <VizRenderer :visualization="selected" />
        </div>
        <el-empty v-else description="选择一个可视化预览，或输入题目生成。" :image-size="90">
          <el-button type="primary" :icon="MagicStick" @click="generate">生成可视化</el-button>
        </el-empty>
      </div>
    </section>

    <el-dialog v-model="dialogOpen" title="新建可视化" width="580px" align-center>
      <el-form label-position="top">
        <div class="viz-form-grid">
          <el-form-item label="类型">
            <el-select v-model="form.type" @change="syncSpecText">
              <el-option v-for="option in typeOptions" :key="option.value" :value="option.value" :label="option.label" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题">
            <el-input v-model="form.title" maxlength="80" placeholder="例如：二次函数图像" />
          </el-form-item>
        </div>

        <template v-if="isFunctionForm">
          <el-form-item label="表达式">
            <el-input v-model="form.expression" placeholder="例如 x^2 - 4" />
          </el-form-item>
          <div class="viz-form-grid">
            <el-form-item label="区间最小值">
              <el-input-number v-model="form.rangeMin" :step="1" />
            </el-form-item>
            <el-form-item label="区间最大值">
              <el-input-number v-model="form.rangeMax" :step="1" />
            </el-form-item>
          </div>
          <p class="viz-form-note">支持 + - * / ^、sin/cos/sqrt/abs/log/ln/exp 与变量 x；圆锥曲线/三维函数暂按 x 截线展示。</p>
        </template>

        <el-form-item v-else label="spec（JSON）">
          <el-input v-model="form.specText" type="textarea" :rows="12" spellcheck="false" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">生成可视化</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.viz-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.viz-title {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.viz-sub {
  margin-top: 3px;
  max-width: 700px;
  font-size: 12.5px;
  color: var(--muted);
}

.viz-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.viz-error {
  margin-bottom: 16px;
}

.viz-layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.viz-list {
  padding-top: 0;
  max-height: calc(100vh - 250px);
  overflow-y: auto;
}

.viz-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--ink);
}

.viz-item:hover {
  background: var(--paper);
}

.viz-item.active {
  border-color: #b9c8f7;
  background: var(--accent-soft);
}

.viz-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.viz-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
}

.viz-item-meta {
  font-size: 10.5px;
  color: var(--faint);
}

.viz-empty {
  padding: 16px 6px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--faint);
}

.viz-viewer {
  min-height: 440px;
  padding: 18px 20px;
}

.viz-viewer .panel-body {
  padding: 0;
}

.viz-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.viz-form-grid :deep(.el-select),
.viz-form-grid :deep(.el-input-number) {
  width: 100%;
}

.viz-form-note {
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--faint);
  line-height: 1.55;
}

.viz-generate {
  padding: 14px 16px;
  margin-bottom: 16px;
}

.viz-generate-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.viz-generate-row .el-input {
  flex: 1 1 320px;
}

.viz-subject {
  width: 110px;
}

.viz-generate-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--faint);
}

@media (max-width: 1000px) {
  .viz-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .viz-list {
    max-height: none;
  }
}

@media (max-width: 640px) {
  .viz-title {
    font-size: 21px;
  }

  .viz-actions {
    width: 100%;
  }

  .viz-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .viz-viewer {
    padding: 14px 16px;
  }
}
</style>
