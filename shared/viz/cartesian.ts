import { compileExpression } from '../expression';
import type {
  Boundary,
  CartesianRenderModel,
  ConicSegment,
  ConicScene,
  CurveRef,
  FeatureSpec,
  FunctionDefinitionV2,
  FunctionGraphScene,
  RenderCurve,
  RenderPoint,
  RenderRegion,
  VizDiagnostic,
  VizDocumentV2,
} from './types';

export interface CompileOptions {
  width: number;
  height: number;
  params?: Record<string, number>;
  hidden?: Set<string>;
}

type Evaluator = (x: number) => number;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function makeEvaluator(def: FunctionDefinitionV2, params: Record<string, number>): Evaluator {
  const param = def.params[0] ?? 'x';
  const scopeFor = (x: number) => ({ ...params, [param]: x });
  if (def.piecewise?.length) {
    const branches = def.piecewise.map((branch) => ({
      when: compileExpression(branch.when),
      then: compileExpression(branch.then),
    }));
    return (x: number) => {
      for (const branch of branches) {
        try {
          if (branch.when(x, scopeFor(x)) !== 0) return branch.then(x, scopeFor(x));
        } catch {
          return Number.NaN;
        }
      }
      return Number.NaN;
    };
  }
  const fn = compileExpression(def.body);
  return (x: number) => {
    try {
      return fn(x, scopeFor(x));
    } catch {
      return Number.NaN;
    }
  };
}

function dedupe(values: number[], tolerance: number): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const output: number[] = [];
  for (const value of sorted) {
    if (!output.length || Math.abs(value - output[output.length - 1]) > tolerance) output.push(value);
  }
  return output;
}

function bisect(fn: Evaluator, lo: number, hi: number, loValue: number): number | null {
  let left = lo;
  let right = hi;
  let leftValue = loValue;
  for (let index = 0; index < 60; index += 1) {
    const mid = (left + right) / 2;
    const midValue = fn(mid);
    if (!isFiniteNumber(midValue)) return null;
    if (Math.abs(midValue) < 1e-7) return mid;
    if (leftValue * midValue <= 0) {
      right = mid;
    } else {
      left = mid;
      leftValue = midValue;
    }
  }
  return (left + right) / 2;
}

function refineMinimum(fn: Evaluator, lo: number, hi: number): number | null {
  let left = lo;
  let right = hi;
  for (let index = 0; index < 50; index += 1) {
    const m1 = left + (right - left) / 3;
    const m2 = right - (right - left) / 3;
    const v1 = Math.abs(fn(m1));
    const v2 = Math.abs(fn(m2));
    if (!isFiniteNumber(v1) || !isFiniteNumber(v2)) return null;
    if (v1 <= v2) right = m2;
    else left = m1;
  }
  return (left + right) / 2;
}

function findRoots(fn: Evaluator, min: number, max: number, limit: number): number[] {
  const samples = 900;
  const roots: number[] = [];
  let previousX = min;
  let previousY = fn(min);
  for (let index = 1; index <= samples; index += 1) {
    const x = min + ((max - min) * index) / samples;
    const y = fn(x);
    if (isFiniteNumber(previousY) && isFiniteNumber(y)) {
      if (y === 0) roots.push(x);
      else if (previousY === 0) roots.push(previousX);
      else if (previousY * y < 0) {
        const root = bisect(fn, previousX, x, previousY);
        if (root !== null) roots.push(root);
      }
    }
    previousX = x;
    previousY = y;
  }

  // 偶重根不会变号；用局部 |f| 极小值补扫，避免 (x-a)^2 这类零点漏标。
  for (let index = 1; index < samples; index += 1) {
    const x = min + ((max - min) * index) / samples;
    const prev = fn(x - (max - min) / samples);
    const value = fn(x);
    const next = fn(x + (max - min) / samples);
    if (!isFiniteNumber(prev) || !isFiniteNumber(value) || !isFiniteNumber(next)) continue;
    if (Math.abs(value) <= Math.abs(prev) && Math.abs(value) <= Math.abs(next) && Math.abs(value) < 1e-3) {
      const root = refineMinimum(fn, x - (max - min) / samples, x + (max - min) / samples);
      if (root !== null && Math.abs(fn(root)) < 1e-4) roots.push(root);
    }
  }

  const tolerance = Math.max(1e-6, (max - min) * 1e-6);
  return dedupe(roots, tolerance)
    .filter((x) => Math.abs(fn(x)) < 1e-4)
    .slice(0, limit);
}

function findExtrema(fn: Evaluator, min: number, max: number, limit: number): { x: number; y: number }[] {
  const samples = 700;
  const output: { x: number; y: number }[] = [];
  let prevX = min;
  let prevY = fn(min);
  let currentX = min + (max - min) / samples;
  let currentY = fn(currentX);
  for (let index = 2; index <= samples; index += 1) {
    const nextX = min + ((max - min) * index) / samples;
    const nextY = fn(nextX);
    if (isFiniteNumber(prevY) && isFiniteNumber(currentY) && isFiniteNumber(nextY)) {
      const isMax = currentY >= prevY && currentY >= nextY;
      const isMin = currentY <= prevY && currentY <= nextY;
      if (isMax || isMin) {
        let lo = prevX;
        let hi = nextX;
        for (let iter = 0; iter < 45; iter += 1) {
          const m1 = lo + (hi - lo) / 3;
          const m2 = hi - (hi - lo) / 3;
          const v1 = isMax ? fn(m1) : -fn(m1);
          const v2 = isMax ? fn(m2) : -fn(m2);
          if (!isFiniteNumber(v1) || !isFiniteNumber(v2)) break;
          if (v1 <= v2) lo = m1;
          else hi = m2;
        }
        const x = (lo + hi) / 2;
        const y = fn(x);
        if (isFiniteNumber(y)) output.push({ x, y });
      }
    }
    prevX = currentX;
    prevY = currentY;
    currentX = nextX;
    currentY = nextY;
  }
  const tolerance = Math.max(1e-6, (max - min) * 1e-5);
  const unique: { x: number; y: number }[] = [];
  for (const point of output) {
    if (!unique.some((item) => Math.abs(item.x - point.x) < tolerance)) unique.push(point);
  }
  return unique.slice(0, limit);
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  return Number(value.toFixed(3)).toString();
}

function computeFeatures(
  scene: FunctionGraphScene,
  evaluators: Map<string, Evaluator>,
  min: number,
  max: number,
  diagnostics: VizDiagnostic[],
): RenderPoint[] {
  const points: RenderPoint[] = [];
  for (const feature of scene.features) {
    if (feature.kind === 'roots') {
      let first = true;
      for (const name of feature.of) {
        const fn = evaluators.get(name);
        if (!fn) continue;
        const roots = findRoots(fn, min, max, feature.limit ?? 20);
        for (const x of roots) {
          points.push({ x, y: 0, kind: 'root', label: `x=${formatNumber(x)}` });
        }
        if (first && feature.expected !== undefined && roots.length !== feature.expected) {
          diagnostics.push({
            code: 'VIZ_FEATURE_COUNT_MISMATCH',
            severity: 'warning',
            message: `题目描述了 ${feature.expected} 个零点，但在当前区间内验证到 ${roots.length} 个；可能存在区间外零点或重根。`,
            path: 'scene.features',
          });
        }
        first = false;
      }
    } else if (feature.kind === 'intersections') {
      const [leftName, rightName] = feature.of;
      const left = evaluators.get(leftName);
      const right = evaluators.get(rightName);
      if (!left || !right) continue;
      const fn = (x: number) => left(x) - right(x);
      for (const x of findRoots(fn, min, max, feature.limit ?? 20)) {
        const y = left(x);
        if (isFiniteNumber(y)) points.push({ x, y, kind: 'intersection', label: `(${formatNumber(x)}, ${formatNumber(y)})` });
      }
    } else if (feature.kind === 'extrema') {
      for (const name of feature.of) {
        const fn = evaluators.get(name);
        if (!fn) continue;
        for (const point of findExtrema(fn, min, max, feature.limit ?? 12)) {
          points.push({ ...point, kind: 'extremum', label: `(${formatNumber(point.x)}, ${formatNumber(point.y)})` });
        }
      }
    } else if (feature.kind === 'endpoints') {
      for (const name of feature.of) {
        const fn = evaluators.get(name);
        if (!fn) continue;
        for (const x of [min, max]) {
          const y = fn(x);
          if (isFiniteNumber(y)) points.push({ x, y, kind: 'endpoint' });
        }
      }
    }
  }
  const tolerance = Math.max(1e-6, (max - min) * 1e-6);
  const unique: RenderPoint[] = [];
  for (const point of points) {
    if (!unique.some((item) => item.kind === point.kind && Math.abs(item.x - point.x) < tolerance && Math.abs(item.y - point.y) < tolerance)) {
      unique.push(point);
    }
  }
  return unique.slice(0, 50);
}

function sampleCurve(
  id: string,
  label: string,
  role: CurveRef['role'],
  fn: Evaluator,
  view: { x: [number, number]; y: [number, number] },
  width: number,
): RenderCurve {
  const count = clamp(Math.round(width * 1.5), 400, 4000);
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let previousY: number | null = null;
  const gapThreshold = 50 * (view.y[1] - view.y[0]);
  for (let index = 0; index <= count; index += 1) {
    const x = view.x[0] + ((view.x[1] - view.x[0]) * index) / count;
    const y = fn(x);
    const invalid = !isFiniteNumber(y) || Math.abs(y) > 1e6;
    const jump = previousY !== null && isFiniteNumber(y) && Math.abs(y - previousY) > gapThreshold;
    if (invalid || jump) {
      if (current.length > 1) segments.push(current);
      current = [];
      previousY = invalid ? null : y;
      continue;
    }
    current.push({ x, y });
    previousY = y;
  }
  if (current.length > 1) segments.push(current);
  return { id, label, role, segments };
}

function boundaryValue(boundary: Boundary, x: number, evaluators: Map<string, Evaluator>): number {
  if (boundary.kind === 'constant') return boundary.value;
  const fn = evaluators.get(boundary.def);
  return fn ? fn(x) : Number.NaN;
}

function buildBetweenPolygons(
  region: Extract<FunctionGraphScene['regions'][number], { kind: 'between' }>,
  evaluators: Map<string, Evaluator>,
  view: { x: [number, number]; y: [number, number] },
): { polygons: RenderRegion[]; areaRatio: number } {
  const samples = 320;
  const polygons: RenderRegion[] = [];
  let area = 0;
  let start = -1;
  let lowerValues: number[] = [];
  let upperValues: number[] = [];
  const flush = (end: number) => {
    if (start < 0 || end <= start) return;
    const lower: { x: number; y: number }[] = [];
    const upper: { x: number; y: number }[] = [];
    for (let index = start; index <= end; index += 1) {
      const x = view.x[0] + ((view.x[1] - view.x[0]) * index) / samples;
      lower.push({ x, y: clamp(lowerValues[index], view.y[0], view.y[1]) });
      upper.push({ x, y: clamp(upperValues[index], view.y[0], view.y[1]) });
    }
    polygons.push({ polygon: [...lower, ...upper.reverse()], role: 'solution' });
    for (let index = start; index < end; index += 1) {
      const width = (view.x[1] - view.x[0]) / samples;
      const height = Math.max(0, upperValues[index] - lowerValues[index]);
      area += width * Math.min(height, view.y[1] - view.y[0]);
    }
    start = -1;
  };
  for (let index = 0; index <= samples; index += 1) {
    const x = view.x[0] + ((view.x[1] - view.x[0]) * index) / samples;
    const lower = boundaryValue(region.lower, x, evaluators);
    const upper = boundaryValue(region.upper, x, evaluators);
    const valid = isFiniteNumber(lower) && isFiniteNumber(upper) && upper > lower;
    if (valid) {
      if (start < 0) {
        start = index;
        lowerValues = [];
        upperValues = [];
      }
      lowerValues[index] = lower;
      upperValues[index] = upper;
    } else {
      flush(index - 1);
    }
  }
  flush(samples);
  const total = (view.x[1] - view.x[0]) * (view.y[1] - view.y[0]);
  return { polygons, areaRatio: total > 0 ? area / total : 0 };
}

function buildConditionPolygons(
  condition: string,
  axis: 'x' | 'y' = 'x',
  params: Record<string, number>,
  view: { x: [number, number]; y: [number, number] },
): { polygons: RenderRegion[]; areaRatio: number } {
  const fn = compileExpression(condition);
  const samples = 420;
  const polygons: RenderRegion[] = [];
  let start: number | null = null;
  const span = axis === 'x' ? view.x : view.y;
  const flush = (end: number) => {
    if (start === null || end <= start) return;
    const v0 = span[0] + ((span[1] - span[0]) * start) / samples;
    const v1 = span[0] + ((span[1] - span[0]) * end) / samples;
    polygons.push({
      polygon: axis === 'x'
        ? [
            { x: v0, y: view.y[0] },
            { x: v1, y: view.y[0] },
            { x: v1, y: view.y[1] },
            { x: v0, y: view.y[1] },
          ]
        : [
            { x: view.x[0], y: v0 },
            { x: view.x[1], y: v0 },
            { x: view.x[1], y: v1 },
            { x: view.x[0], y: v1 },
          ],
      role: 'solution',
    });
    start = null;
  };
  for (let index = 0; index <= samples; index += 1) {
    const value = span[0] + ((span[1] - span[0]) * index) / samples;
    let truthy = false;
    try {
      truthy = axis === 'x'
        ? fn(value, params) !== 0
        : fn(0, { ...params, y: value }) !== 0;
    } catch {
      truthy = false;
    }
    if (truthy && start === null) start = index;
    if ((!truthy || index === samples) && start !== null) flush(truthy ? index : index - 1);
  }
  let area = 0;
  for (const item of polygons) {
    if (axis === 'x') {
      const xs = item.polygon.map((point) => point.x);
      area += (Math.max(...xs) - Math.min(...xs)) * (view.y[1] - view.y[0]);
    } else {
      const ys = item.polygon.map((point) => point.y);
      area += (Math.max(...ys) - Math.min(...ys)) * (view.x[1] - view.x[0]);
    }
  }
  const total = (view.x[1] - view.x[0]) * (view.y[1] - view.y[0]);
  return { polygons, areaRatio: total > 0 ? area / total : 0 };
}

function compileRegions(
  scene: FunctionGraphScene,
  evaluators: Map<string, Evaluator>,
  params: Record<string, number>,
  view: { x: [number, number]; y: [number, number] },
  diagnostics: VizDiagnostic[],
): RenderRegion[] {
  const regions: RenderRegion[] = [];
  for (const region of scene.regions) {
    try {
      const result = region.kind === 'between'
        ? buildBetweenPolygons(region, evaluators, view)
        : buildConditionPolygons(region.condition, region.axis ?? 'x', params, view);
      if (result.areaRatio > 0.6) {
        diagnostics.push({
          code: 'VIZ_REGION_TOO_LARGE',
          severity: 'warning',
          message: '区域覆盖超过绘图区的 60%，已丢弃该区域以避免整块填充。',
          path: 'scene.regions',
        });
        continue;
      }
      regions.push(...result.polygons);
    } catch {
      diagnostics.push({
        code: 'VIZ_REGION_INVALID',
        severity: 'warning',
        message: '区域条件无法计算，已跳过。',
        path: 'scene.regions',
      });
    }
  }
  return regions;
}

function conicSegments(
  scene: ConicScene,
  width: number,
  diagnostics: VizDiagnostic[],
): { view: { x: [number, number]; y: [number, number] }; segments: ConicSegment[] } {
  const xRange = scene.view.x;
  const yRange = scene.view.y ?? [xRange[0], xRange[1]];
  const fn = compileExpression(scene.expression);
  const base = clamp(Math.round(width / 8), 40, 100);
  const maxDepth = 4;
  const segments: ConicSegment[] = [];
  const xSpan = xRange[1] - xRange[0];
  const ySpan = yRange[1] - yRange[0];

  const valueAt = (x: number, y: number): number => {
    try {
      return fn(x, { y });
    } catch {
      return Number.NaN;
    }
  };
  const interpolate = (p1: [number, number], p2: [number, number], v1: number, v2: number): [number, number] => {
    const t = Math.abs(v1) / (Math.abs(v1) + Math.abs(v2) || 1);
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  };
  const emit = (x0: number, x1: number, y0: number, y1: number, depth: number): void => {
    const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const values = corners.map(([x, y]) => valueAt(x, y));
    if (values.some((value) => !isFiniteNumber(value))) return;
    const crossings: [number, number][] = [];
    for (let edge = 0; edge < 4; edge += 1) {
      const next = (edge + 1) % 4;
      const a = values[edge];
      const b = values[next];
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings.push(interpolate(corners[edge], corners[next], a, b));
    }
    if (crossings.length === 0) return;
    const normalizedSize = Math.hypot((x1 - x0) / (xSpan || 1), (y1 - y0) / (ySpan || 1));
    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    // 双线性插值在单元中心等于四角平均；偏离越大说明曲率越高，需要继续细分。
    const center = valueAt(xm, ym);
    const average = (values[0] + values[1] + values[2] + values[3]) / 4;
    const scale = Math.max(1e-9, ...values.map((value) => Math.abs(value)));
    const curved = isFiniteNumber(center) && Math.abs(center - average) > scale * 0.12;
    if (depth < maxDepth && (crossings.length === 4 || normalizedSize > 1 / (base * 2) || curved)) {
      emit(x0, xm, y0, ym, depth + 1);
      emit(xm, x1, y0, ym, depth + 1);
      emit(x0, xm, ym, y1, depth + 1);
      emit(xm, x1, ym, y1, depth + 1);
      return;
    }
    if (crossings.length === 2) {
      segments.push({ from: { x: crossings[0][0], y: crossings[0][1] }, to: { x: crossings[1][0], y: crossings[1][1] } });
    } else if (crossings.length === 4) {
      segments.push({ from: { x: crossings[0][0], y: crossings[0][1] }, to: { x: crossings[1][0], y: crossings[1][1] } });
      segments.push({ from: { x: crossings[2][0], y: crossings[2][1] }, to: { x: crossings[3][0], y: crossings[3][1] } });
    }
  };

  for (let row = 0; row < base; row += 1) {
    const y0 = yRange[0] + (ySpan * row) / base;
    const y1 = yRange[0] + (ySpan * (row + 1)) / base;
    for (let col = 0; col < base; col += 1) {
      const x0 = xRange[0] + (xSpan * col) / base;
      const x1 = xRange[0] + (xSpan * (col + 1)) / base;
      emit(x0, x1, y0, y1, 0);
    }
  }
  if (!segments.length) {
    diagnostics.push({ code: 'VIZ_CONIC_EMPTY', severity: 'warning', message: '当前视窗内没有找到隐式曲线，请检查方程或区间。' });
  }
  return { view: { x: xRange, y: yRange }, segments };
}

export function compileCartesian(doc: VizDocumentV2, options: CompileOptions): CartesianRenderModel {
  const diagnostics: VizDiagnostic[] = [...(doc.diagnostics ?? [])];
  if (doc.kind === 'conic') {
    const scene = doc.scene as ConicScene;
    const result = conicSegments(scene, options.width, diagnostics);
    return { ...result, curves: [], points: [], regions: [], conicSegments: result.segments, diagnostics };
  }

  const scene = doc.scene as FunctionGraphScene;
  const params: Record<string, number> = {};
  for (const parameter of scene.parameters) params[parameter.name] = parameter.value;
  Object.assign(params, options.params ?? {});
  const evaluators = new Map<string, Evaluator>();
  for (const definition of scene.definitions) evaluators.set(definition.name, makeEvaluator(definition, params));
  const hidden = options.hidden ?? new Set<string>();
  const visible = scene.curves.filter((curve) => curve.visible && !hidden.has(curve.def));
  const points = computeFeatures(scene, evaluators, scene.view.x[0], scene.view.x[1], diagnostics);

  let yRange: [number, number];
  if (scene.view.y) {
    yRange = scene.view.y;
  } else {
    const ys: number[] = [];
    for (const curve of visible) {
      const fn = evaluators.get(curve.def);
      if (!fn) continue;
      for (let index = 0; index <= 360; index += 1) {
        const x = scene.view.x[0] + ((scene.view.x[1] - scene.view.x[0]) * index) / 360;
        const y = fn(x);
        if (isFiniteNumber(y) && Math.abs(y) < 1e6) ys.push(y);
      }
    }
    for (const point of points) if (isFiniteNumber(point.y)) ys.push(point.y);
    ys.sort((a, b) => a - b);
    if (ys.length < 2) {
      yRange = [-5, 5];
      diagnostics.push({ code: 'VIZ_VIEW_DEGENERATE', severity: 'warning', message: '当前区间内没有有效函数值，已使用默认纵轴范围。' });
    } else {
      const low = ys[Math.floor((ys.length - 1) * 0.02)];
      const high = ys[Math.ceil((ys.length - 1) * 0.98)];
      const span = high - low;
      if (span < 1e-6) {
        yRange = [low - 1, high + 1];
      } else {
        yRange = [low - span * 0.08, high + span * 0.08];
      }
    }
  }
  const view = { x: scene.view.x, y: yRange };
  const curves: RenderCurve[] = [];
  for (const curve of visible) {
    const definition = scene.definitions.find((item) => item.name === curve.def);
    const fn = evaluators.get(curve.def);
    if (!definition || !fn) continue;
    const sampled = sampleCurve(definition.name, definition.display, curve.role, fn, view, options.width);
    if (sampled.segments.length) curves.push(sampled);
    else diagnostics.push({ code: 'VIZ_CURVE_EMPTY', severity: 'warning', message: `函数 ${definition.display} 在当前区间内没有可绘制曲线。` });
  }
  const regions = compileRegions(scene, evaluators, params, view, diagnostics);
  return { view, curves, points, regions, conicSegments: [], diagnostics };
}
