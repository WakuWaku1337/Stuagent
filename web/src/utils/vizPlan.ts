import { validateVizDocument } from '../../../shared/viz/schema';
import type {
  FeatureSpec,
  FunctionDefinitionV2,
  VizDiagnostic,
  VizDocumentV2,
} from '../../../shared/viz/types';
import type { Visualization } from '../api/visualize';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nameFromLabel(label: string, index: number): string {
  const match = label.match(/^([A-Za-z])\s*\(/);
  if (match && !['x', 'y', 'pi', 'e'].includes(match[1])) return match[1];
  return ['f', 'g', 'h', 'k', 'p', 'q'][index] ?? `f${index}`;
}

function unique(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  let index = 2;
  while (used.has(`${name}${index}`)) index += 1;
  return `${name}${index}`;
}

function rangeOf(spec: Record<string, unknown>): [number, number] {
  const range = spec.range;
  if (Array.isArray(range) && range.length === 2 && Number.isFinite(Number(range[0])) && Number.isFinite(Number(range[1])) && Number(range[0]) < Number(range[1])) {
    return [Number(range[0]), Number(range[1])];
  }
  return [-10, 10];
}

function looksPolynomial(body: string): boolean {
  return !/sin|cos|tan|abs|sqrt|log|ln|exp|floor|ceil|round/.test(body) && body.includes('x');
}

/**
 * 旧版 v1 function2d/conic 只能降级读取：曲线与点保留，区域填充全部丢弃。
 * 这样既不会把模型手写的 fill/where 重新交给旧渲染器，也能让旧记录走新的 SVG 渲染器。
 */
export function legacyToVizDocument(visualization: Visualization): VizDocumentV2 {
  const spec = visualization.spec;
  const diagnostics: VizDiagnostic[] = [{
    code: 'VIZ_LEGACY_SPEC',
    severity: 'info',
    message: '旧版图形已降级显示：区域填充已关闭，仅保留曲线与特征点。',
  }];
  if (visualization.type === 'conic') {
    const expression = typeof spec.expression === 'string' ? spec.expression : '';
    const range = rangeOf(spec);
    return validateVizDocument({
      schema: 'edupi.viz/v2',
      kind: 'conic',
      title: visualization.title,
      input: { text: visualization.title, recovered: true },
      provenance: { generator: 'manual', version: 'legacy@1' },
      scene: {
        expression,
        label: expression,
        view: { x: range, y: range, mode: 'auto' },
      },
      diagnostics,
    });
  }

  const rawFunctions = Array.isArray(spec.functions) && spec.functions.length
    ? spec.functions
    : [{ expression: spec.expression, label: `y=${String(spec.expression ?? '')}` }];
  const used = new Set<string>();
  const definitions: FunctionDefinitionV2[] = rawFunctions.map((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const label = typeof item.label === 'string' && item.label.trim()
      ? item.label.trim()
      : `f(x)=${String(item.expression ?? '')}`;
    const name = unique(nameFromLabel(label, index), used);
    used.add(name);
    const piecewise = Array.isArray(item.piecewise)
      ? item.piecewise
          .filter(isRecord)
          .map((branch) => ({ when: String(branch.when ?? ''), then: String(branch.then ?? '') }))
          .filter((branch) => branch.when && branch.then)
      : undefined;
    return {
      name,
      params: ['x'],
      body: piecewise?.length ? '' : String(item.expression ?? ''),
      display: label,
      ...(piecewise?.length ? { piecewise } : {}),
    };
  });
  const names = new Set(definitions.map((item) => item.name));
  const parameters = (Array.isArray(spec.sliders) ? spec.sliders : [])
    .filter(isRecord)
    .map((item) => ({
      name: String(item.param ?? ''),
      min: Number(item.min),
      max: Number(item.max),
      step: Number(item.step) || 0.1,
      value: Number(item.value),
    }))
    .filter((item) => item.name && !names.has(item.name) && Number.isFinite(item.min) && Number.isFinite(item.max) && item.min < item.max)
    .map((item) => ({
      ...item,
      value: Number.isFinite(item.value) && item.value >= item.min && item.value <= item.max ? item.value : (item.min + item.max) / 2,
    }))
    .slice(0, 6);

  const features: FeatureSpec[] = definitions.map((definition, index) => ({
    kind: 'roots',
    of: [definition.name],
    limit: 20,
    ...(index === 0 ? {} : {}),
  }));
  for (const definition of definitions) {
    if (looksPolynomial(definition.body)) features.push({ kind: 'extrema', of: [definition.name], limit: 6 });
  }
  if (definitions.length >= 2 && Array.isArray(spec.relations) && spec.relations.length) {
    features.push({ kind: 'intersections', of: [definitions[0].name, definitions[1].name], limit: 20 });
  }

  return validateVizDocument({
    schema: 'edupi.viz/v2',
    kind: 'function-graph',
    title: visualization.title,
    input: { text: visualization.title, recovered: true },
    provenance: { generator: 'manual', version: 'legacy@1' },
    scene: {
      definitions,
      curves: definitions.map((definition, index) => ({
        def: definition.name,
        role: index === 0 ? 'primary' : 'secondary',
        visible: true,
      })),
      parameters,
      view: { x: rangeOf(spec), mode: 'auto' },
      features,
      regions: [],
    },
    diagnostics,
  });
}
