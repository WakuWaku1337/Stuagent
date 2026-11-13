<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { Visualization } from '../../api/visualize';
import { legacyToVizDocument } from '../../utils/vizPlan';
import { compileCartesian } from '../../../../shared/viz/cartesian';
import type {
  ConicScene,
  FunctionGraphScene,
  RenderCurve,
  RenderRegion,
  VizDiagnostic,
  VizDocumentV2,
} from '../../../../shared/viz/types';

const props = defineProps<{ visualization: Visualization }>();

const host = ref<HTMLDivElement>();
const width = ref(720);
const height = 420;
const hidden = reactive<Record<string, boolean>>({});
const params = reactive<Record<string, number>>({});
const renderError = ref('');
const docError = ref('');
let observer: ResizeObserver | null = null;

const margin = { left: 48, right: 18, top: 14, bottom: 34 };
const plotWidth = computed(() => Math.max(80, width.value - margin.left - margin.right));
const plotHeight = height - margin.top - margin.bottom;

const doc = computed<VizDocumentV2 | null>(() => {
  docError.value = '';
  try {
    return props.visualization.schema_version === 2
      ? props.visualization.spec as unknown as VizDocumentV2
      : legacyToVizDocument(props.visualization);
  } catch (error) {
    docError.value = error instanceof Error ? error.message : String(error);
    return null;
  }
});
const functionScene = computed<FunctionGraphScene | null>(() =>
  doc.value?.kind === 'function-graph' ? (doc.value.scene as FunctionGraphScene) : null,
);
const conicScene = computed<ConicScene | null>(() =>
  doc.value?.kind === 'conic' ? (doc.value.scene as ConicScene) : null,
);

const renderModel = computed(() => {
  renderError.value = '';
  try {
    const currentDoc = doc.value;
    if (!currentDoc) return null;
    return compileCartesian(currentDoc, {
      width: width.value,
      height,
      params: { ...params },
      hidden: new Set(Object.keys(hidden).filter((key) => hidden[key])),
    });
  } catch (error) {
    renderError.value = error instanceof Error ? error.message : String(error);
    return null;
  }
});

const diagnostics = computed<VizDiagnostic[]>(() => renderModel.value?.diagnostics ?? []);

function xScale(x: number): number {
  const view = renderModel.value?.view.x ?? [-10, 10];
  return margin.left + ((x - view[0]) / (view[1] - view[0])) * plotWidth.value;
}

function yScale(y: number): number {
  const view = renderModel.value?.view.y ?? [-10, 10];
  return margin.top + ((view[1] - y) / (view[1] - view[0])) * plotHeight;
}

function niceStep(span: number, count: number): number {
  const rough = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const normalized = rough / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * power;
}

function ticks(min: number, max: number, count: number): number[] {
  const step = niceStep(max - min, count);
  const start = Math.ceil(min / step) * step;
  const output: number[] = [];
  for (let value = start; value <= max + step * 0.001; value += step) output.push(Number(value.toFixed(10)));
  return output;
}

const xTicks = computed(() => ticks((renderModel.value?.view.x ?? [-10, 10])[0], (renderModel.value?.view.x ?? [-10, 10])[1], 10));
const yTicks = computed(() => ticks((renderModel.value?.view.y ?? [-10, 10])[0], (renderModel.value?.view.y ?? [-10, 10])[1], 8));

function tickLabel(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  return Number(value.toFixed(3)).toString();
}

function curvePath(curve: RenderCurve): string {
  return curve.segments
    .map((segment) => segment.map((point, index) => `${index === 0 ? 'M' : 'L'}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(' '))
    .join(' ');
}

function regionPath(region: RenderRegion): string {
  if (!region.polygon.length) return '';
  return `${region.polygon.map((point, index) => `${index === 0 ? 'M' : 'L'}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(' ')} Z`;
}

const conicPath = computed(() =>
  (renderModel.value?.conicSegments ?? [])
    .map((segment) => `M${xScale(segment.from.x).toFixed(2)} ${yScale(segment.from.y).toFixed(2)} L${xScale(segment.to.x).toFixed(2)} ${yScale(segment.to.y).toFixed(2)}`)
    .join(' '),
);

const clipId = computed(() => `viz-clip-${props.visualization.visualization_id.replace(/[^a-zA-Z0-9_-]/g, '')}`);

function resetParams() {
  for (const key of Object.keys(params)) delete params[key];
  for (const parameter of functionScene.value?.parameters ?? []) params[parameter.name] = parameter.value;
  for (const key of Object.keys(hidden)) delete hidden[key];
}

function reset() {
  resetParams();
  render();
}

function render() {
  // computed 依赖 params/hidden/width；这里触发一次响应式读取即可。
  void renderModel.value;
}

async function screenshot(): Promise<string | null> {
  const svg = host.value?.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('svg 转图片失败'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width.value;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function measure() {
  if (!host.value) return;
  width.value = Math.max(360, Math.round(host.value.clientWidth || 720));
}

onMounted(() => {
  resetParams();
  measure();
  observer = new ResizeObserver(measure);
  if (host.value) observer.observe(host.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

watch(
  () => props.visualization.visualization_id,
  () => {
    resetParams();
    measure();
  },
);

defineExpose({ reset, screenshot });
</script>

<template>
  <div ref="host" class="cartesian-plot">
    <div v-if="docError || renderError" class="viz-error">{{ docError || renderError }}</div>
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="visualization.title"
      class="viz-svg"
    >
      <defs>
        <clipPath :id="clipId">
          <rect :x="margin.left" :y="margin.top" :width="plotWidth" :height="plotHeight" />
        </clipPath>
      </defs>

      <g class="viz-grid">
        <line
          v-for="tick in xTicks"
          :key="`gx-${tick}`"
          :x1="xScale(tick)"
          :x2="xScale(tick)"
          :y1="margin.top"
          :y2="margin.top + plotHeight"
        />
        <line
          v-for="tick in yTicks"
          :key="`gy-${tick}`"
          :x1="margin.left"
          :x2="margin.left + plotWidth"
          :y1="yScale(tick)"
          :y2="yScale(tick)"
        />
      </g>

      <g class="viz-axes">
        <line
          v-if="(renderModel?.view.x[0] ?? -1) <= 0 && (renderModel?.view.x[1] ?? 1) >= 0"
          :x1="xScale(0)"
          :x2="xScale(0)"
          :y1="margin.top"
          :y2="margin.top + plotHeight"
        />
        <line
          v-if="(renderModel?.view.y[0] ?? -1) <= 0 && (renderModel?.view.y[1] ?? 1) >= 0"
          :x1="margin.left"
          :x2="margin.left + plotWidth"
          :y1="yScale(0)"
          :y2="yScale(0)"
        />
      </g>

      <g class="viz-tick-labels">
        <text v-for="tick in xTicks" :key="`tx-${tick}`" :x="xScale(tick)" :y="margin.top + plotHeight + 18" text-anchor="middle">
          {{ tickLabel(tick) }}
        </text>
        <text v-for="tick in yTicks" :key="`ty-${tick}`" :x="margin.left - 8" :y="yScale(tick) + 4" text-anchor="end">
          {{ tickLabel(tick) }}
        </text>
      </g>

      <g class="viz-regions" :clip-path="`url(#${clipId})`">
        <path
          v-for="(region, index) in renderModel?.regions ?? []"
          :key="`region-${index}`"
          :d="regionPath(region)"
          class="viz-region"
          data-viz-role="region"
          fill="rgba(64,158,255,0.14)"
          stroke="none"
        />
      </g>

      <g class="viz-curves" :clip-path="`url(#${clipId})`">
        <path
          v-for="curve in renderModel?.curves ?? []"
          :key="curve.id"
          :d="curvePath(curve)"
          class="viz-curve"
          :class="`viz-curve-${curve.role}`"
          data-viz-role="curve"
          fill="none"
          :stroke="curve.role === 'primary' ? '#409eff' : curve.role === 'secondary' ? '#f56c6c' : '#8a94a6'"
          :stroke-width="curve.role === 'primary' ? 2 : 1.7"
          :stroke-dasharray="curve.role === 'reference' ? '5 5' : undefined"
        />
        <path
          v-if="conicPath"
          :d="conicPath"
          class="viz-curve viz-curve-primary"
          data-viz-role="curve"
          fill="none"
          stroke="#409eff"
          stroke-width="2"
        />
      </g>

      <g class="viz-points">
        <g v-for="(point, index) in renderModel?.points ?? []" :key="`point-${index}`">
          <circle :cx="xScale(point.x)" :cy="yScale(point.y)" r="3.5" fill="#15202b" />
          <text
            v-if="index < 8 && point.label"
            :x="xScale(point.x) + 6"
            :y="yScale(point.y) - 6"
            class="viz-point-label"
          >{{ point.label }}</text>
        </g>
      </g>
    </svg>

    <div v-if="diagnostics.length" class="viz-diagnostics">
      <div
        v-for="(item, index) in diagnostics"
        :key="`diag-${index}`"
        class="viz-diagnostic"
        :class="`viz-diagnostic-${item.severity}`"
      >
        {{ item.message }}
      </div>
    </div>

    <div v-if="functionScene?.curves.length" class="viz-legend">
      <label v-for="curve in functionScene.curves" :key="curve.def" class="viz-legend-item">
        <input v-model="hidden[curve.def]" type="checkbox" @change="render" />
        <span
          class="viz-dot"
          :style="{ background: curve.role === 'primary' ? '#409eff' : curve.role === 'secondary' ? '#f56c6c' : '#8a94a6' }"
        />
        <span :title="functionScene.definitions.find((item) => item.name === curve.def)?.display">
          {{ functionScene.definitions.find((item) => item.name === curve.def)?.display ?? curve.def }}
        </span>
      </label>
    </div>

    <div v-if="functionScene?.parameters.length" class="viz-sliders">
      <label v-for="parameter in functionScene.parameters" :key="parameter.name" class="viz-slider">
        <span>{{ parameter.name }} = {{ (params[parameter.name] ?? parameter.value).toFixed(2) }}</span>
        <el-slider
          v-model="params[parameter.name]"
          :min="parameter.min"
          :max="parameter.max"
          :step="parameter.step"
          size="small"
          @input="render"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.cartesian-plot {
  width: 100%;
  min-height: 420px;
}

.viz-svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fbfcfc;
}

.viz-grid line {
  stroke: #e8ecec;
  stroke-width: 1;
}

.viz-axes line {
  stroke: #65717e;
  stroke-width: 1.2;
}

.viz-tick-labels text,
.viz-point-label {
  font-size: 10px;
  fill: #6f7b88;
}

.viz-point-label {
  fill: #15202b;
}

.viz-error {
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid #e9c7c4;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}

.viz-diagnostics {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.viz-diagnostic {
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  background: #f6f7f8;
  color: var(--muted);
}

.viz-diagnostic-warning {
  background: #fff7e8;
  color: #8a5a12;
}

.viz-diagnostic-error {
  background: var(--danger-soft);
  color: var(--danger);
}

.viz-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.viz-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
}

.viz-legend-item span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viz-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}

.viz-sliders {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px 20px;
  margin-top: 10px;
}

.viz-slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
  color: var(--muted);
}
</style>
