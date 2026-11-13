<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import functionPlot from 'function-plot';
import type { Visualization } from '../../api/visualize';
import { compileExpression } from '../../utils/expression';

const props = defineProps<{ visualization: Visualization }>();

const host = ref<HTMLDivElement>();
const hidden = reactive<Record<number, boolean>>({});
const params = reactive<Record<string, number>>({});
const renderError = ref('');

interface FnItem {
  expression: string;
  color: string;
  label: string;
  piecewise?: { when: string; then: string }[];
}

const DEFAULT_COLORS = ['#409eff', '#f56c6c', '#67c23a', '#e6a23c', '#b07ce8', '#5b8ff9'];

function functionItems(): FnItem[] {
  const spec = props.visualization.spec;
  const raw = Array.isArray(spec.functions) ? spec.functions : [];
  if (raw.length) {
    return raw.map((item, index) => {
      const fn = (item ?? {}) as Record<string, unknown>;
      const piecewise = Array.isArray(fn.piecewise)
        ? fn.piecewise
            .map((branch) => (branch ?? {}) as Record<string, unknown>)
            .map((branch) => ({ when: String(branch.when ?? ''), then: String(branch.then ?? '') }))
            .filter((branch) => branch.when && branch.then)
        : undefined;
      return {
        expression: String(fn.expression ?? ''),
        color: typeof fn.color === 'string' ? fn.color : DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        label: typeof fn.label === 'string' ? fn.label : String(fn.expression ?? ''),
        piecewise: piecewise?.length ? piecewise : undefined,
      };
    });
  }
  return [{ expression: String(spec.expression ?? ''), color: DEFAULT_COLORS[0], label: String(spec.expression ?? '') }];
}

function compileItem(item: FnItem): (x: number) => number {
  if (item.piecewise?.length) {
    const branches = item.piecewise.map((branch) => ({
      when: compileExpression(branch.when),
      then: compileExpression(branch.then),
    }));
    return (x: number) => {
      for (const branch of branches) {
        if (branch.when(x, params) !== 0) return branch.then(x, params);
      }
      return Number.NaN;
    };
  }
  const fn = compileExpression(item.expression);
  return (x: number) => fn(x, params);
}

function rangeOf(): [number, number] {
  const raw = props.visualization.spec.range;
  if (Array.isArray(raw) && raw.length === 2 && Number.isFinite(Number(raw[0])) && Number.isFinite(Number(raw[1]))) {
    return [Number(raw[0]), Number(raw[1])];
  }
  return [-10, 10];
}

function slidersOf(): { param: string; min: number; max: number; step: number; value: number }[] {
  const raw = props.visualization.spec.sliders;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const slider = (item ?? {}) as Record<string, unknown>;
    const param = String(slider.param ?? 'a');
    const min = Number(slider.min ?? 0);
    const max = Number(slider.max ?? 1);
    return {
      param,
      min,
      max,
      step: Number(slider.step ?? 0.1) || 0.1,
      value: Number(slider.value ?? (min + max) / 2),
    };
  });
}

function scanRoots(fn: (x: number) => number, [min, max]: [number, number]): number[] {
  const roots: number[] = [];
  const steps = 400;
  let previousX = min;
  let previousY = fn(min);
  for (let index = 1; index <= steps; index += 1) {
    const x = min + ((max - min) * index) / steps;
    const y = fn(x);
    if (Number.isFinite(previousY) && Number.isFinite(y) && previousY * y <= 0 && previousY !== y) {
      let lo = previousX;
      let hi = x;
      for (let iter = 0; iter < 40; iter += 1) {
        const mid = (lo + hi) / 2;
        if (fn(lo) * fn(mid) <= 0) hi = mid;
        else lo = mid;
      }
      roots.push((lo + hi) / 2);
    }
    previousX = x;
    previousY = y;
  }
  return roots;
}

function resolveSide(side: string, items: FnItem[]): string {
  const name = side.trim();
  if (/^[a-zA-Z]$/.test(name)) {
    const lower = name.toLowerCase();
    const index = items.findIndex((item) => {
      const label = item.label.trim().toLowerCase();
      return label === lower || label.startsWith(`${lower}(`);
    });
    if (index >= 0) return items[index].expression;
  }
  return name;
}

function regionDatum(where: string, fill: string, range: [number, number], scope: Record<string, number>, items: FnItem[]) {
  const match = where.match(/^(.+?)(<=|>=|<|>)(.+)$/);
  if (!match) return null;
  const left = compileExpression(resolveSide(match[1], items));
  const right = compileExpression(resolveSide(match[3], items));
  const operator = match[2];
  const holds = (x: number) => {
    const a = left(x, scope);
    const b = right(x, scope);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (operator === '<') return a < b;
    if (operator === '<=') return a <= b;
    if (operator === '>') return a > b;
    return a >= b;
  };
  const samples = 160;
  const xs: number[] = [];
  for (let index = 0; index <= samples; index += 1) xs.push(range[0] + ((range[1] - range[0]) * index) / samples);
  const intervals: [number, number][] = [];
  let start: number | null = null;
  for (let index = 0; index < xs.length; index += 1) {
    const ok = holds(xs[index]);
    if (ok && start === null) start = index;
    if ((!ok || index === xs.length - 1) && start !== null) {
      intervals.push([start, ok ? index : index - 1]);
      start = null;
    }
  }
  const boundary: [number, number][] = [];
  for (const [a, b] of intervals) {
    if (b - a < 1) continue;
    for (let index = a; index <= b; index += 1) boundary.push([xs[index], left(xs[index], scope)]);
    for (let index = b; index >= a; index -= 1) boundary.push([xs[index], right(xs[index], scope)]);
  }
  if (boundary.length < 4) return null;
  const at = (t: number): [number, number] => {
    const position = t * (boundary.length - 1);
    const index = Math.min(Math.floor(position), boundary.length - 2);
    const frac = position - index;
    return [
      boundary[index][0] + (boundary[index + 1][0] - boundary[index][0]) * frac,
      boundary[index][1] + (boundary[index + 1][1] - boundary[index][1]) * frac,
    ];
  };
  return {
    fnType: 'parametric' as const,
    sampler: 'builtIn' as const,
    x: (scope: { t: number }) => at(scope.t)[0],
    y: (scope: { t: number }) => at(scope.t)[1],
    range: [0, 1] as [number, number],
    closed: true,
    graphType: 'polyline' as const,
    nSamples: 200,
    skipTip: true,
    attr: { fill, stroke: 'none' },
    scope,
  };
}

function buildData() {
  const spec = props.visualization.spec;
  const range = rangeOf();
  const scope = { ...params };
  const items = functionItems();
  const data: Record<string, unknown>[] = [];

  for (const raw of Array.isArray(spec.regions) ? spec.regions : []) {
    const region = (raw ?? {}) as Record<string, unknown>;
    const datum = regionDatum(String(region.where ?? ''), String(region.fill ?? 'rgba(64,158,255,0.2)'), range, scope, items);
    if (datum) data.push(datum);
  }

  const implicitMode = props.visualization.type === 'conic' || spec.implicit === true;
  const compiled = new Map<number, (x: number) => number>();
  const errors: string[] = [];
  items.forEach((item, index) => {
    if (hidden[index]) return;
    try {
      const fn = compileItem(item);
      const samples = [range[0], (range[0] + range[1]) / 2, range[1]]
        .map((x) => fn(x))
        .filter((value) => !Number.isNaN(value));
      if (samples.length === 0 || samples.some((value) => !Number.isFinite(value))) {
        throw new Error('在绘图区间内不可计算');
      }
      compiled.set(index, fn);
    } catch (error) {
      errors.push(`${item.label}：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (!implicitMode && items.some((_item, index) => !hidden[index]) && compiled.size === 0) {
    renderError.value = errors.join('；') || '没有可绘制的函数';
    return [];
  }
  renderError.value = errors.join('；');

  items.forEach((item, index) => {
    if (hidden[index]) return;
    const fn = compiled.get(index);
    if (!fn) return;
    if (implicitMode) {
      const evaluator = compileExpression(item.expression);
      data.push({
        fn: (scope: { x: number; y?: number }) => evaluator(scope.x, { ...params, y: scope.y ?? 0 }),
        fnType: 'implicit',
        color: item.color,
        attr: { 'stroke-width': 2 },
      });
    } else {
      data.push({ fn: (scope: { x: number }) => fn(scope.x), color: item.color, attr: { 'stroke-width': 2 } });
    }
  });

  const markers: [number, number][] = [];
  for (const raw of Array.isArray(spec.relations) ? spec.relations : []) {
    const relation = (raw ?? {}) as Record<string, unknown>;
    const solve = String(relation.solve ?? '');
    const sides = solve.split('=');
    if (sides.length !== 2) continue;
    try {
      const leftExpr = resolveSide(sides[0], items);
      const rightExpr = resolveSide(sides[1], items);
      const left = compileExpression(leftExpr);
      const right = compileExpression(rightExpr);
      for (const x of scanRoots((value) => left(value, scope) - right(value, scope), range)) {
        markers.push([x, left(x, scope)]);
      }
    } catch {
      // 关系式不是关于 x 的表达式（如未解析出函数名）时跳过标记，不影响曲线
    }
  }
  items.forEach((item, index) => {
    if (hidden[index] || implicitMode) return;
    const fn = compiled.get(index);
    if (!fn) return;
    try {
      for (const x of scanRoots((value) => fn(value), range)) markers.push([x, 0]);
    } catch {
      // 该函数不可数值求值时跳过零点标记
    }
  });
  if (markers.length) {
    data.push({ fnType: 'points', sampler: 'builtIn', graphType: 'scatter', points: markers, color: '#15202b', attr: { r: 3.5, fill: '#15202b' } });
  }
  return data;
}

function render(resetDomain = false) {
  if (!host.value) return;
  renderError.value = '';
  try {
    const range = rangeOf();
    const data = buildData();
    if (data.length === 0 && renderError.value) return;
    functionPlot({
      target: host.value,
      width: host.value.clientWidth || 720,
      height: 420,
      grid: true,
      disableZoom: false,
      data: data as never,
      ...(resetDomain ? { xDomain: range } : {}),
    });
  } catch (error) {
    renderError.value = error instanceof Error ? error.message : String(error);
  }
}

function reset() {
  for (const slider of slidersOf()) params[slider.param] = slider.value;
  render(true);
}

async function screenshot(): Promise<string | null> {
  const svg = host.value?.querySelector('svg');
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
    canvas.width = svg.clientWidth || 720;
    canvas.height = svg.clientHeight || 420;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

onMounted(async () => {
  for (const slider of slidersOf()) params[slider.param] = slider.value;
  await nextTick();
  render(true);
  window.addEventListener('resize', onResize);
});

function onResize() {
  render();
}

watch(() => props.visualization, async () => {
  for (const slider of slidersOf()) params[slider.param] = slider.value;
  await nextTick();
  render(true);
});

onBeforeUnmount(() => window.removeEventListener('resize', onResize));

defineExpose({ reset, screenshot });
</script>

<template>
  <div class="fn-chart">
    <div v-if="renderError" class="fn-error">{{ renderError }}</div>
    <div ref="host" class="fn-host" />
    <div class="fn-legend">
      <label v-for="(item, index) in functionItems()" :key="index" class="fn-legend-item">
        <input v-model="hidden[index]" type="checkbox" :true-value="false" :false-value="true" @change="render()" />
        <span class="fn-dot" :style="{ background: item.color }" />
        <span>{{ item.label }}</span>
      </label>
    </div>
    <div v-if="slidersOf().length" class="fn-sliders">
      <label v-for="slider in slidersOf()" :key="slider.param" class="fn-slider">
        <span>{{ slider.param }} = {{ (params[slider.param] ?? slider.value).toFixed(2) }}</span>
        <el-slider
          v-model="params[slider.param]"
          :min="slider.min"
          :max="slider.max"
          :step="slider.step"
          size="small"
          @input="render()"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.fn-host {
  width: 100%;
  min-height: 420px;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  background: #fbfcfc;
}

.fn-error {
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid #e9c7c4;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}

.fn-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.fn-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
}

.fn-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.fn-sliders {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px 20px;
  margin-top: 10px;
}

.fn-slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
  color: var(--muted);
}
</style>