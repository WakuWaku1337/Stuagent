import { createHash } from 'node:crypto';
import { compileExpression } from '../../../../shared/expression.ts';
import { validateVizDocument } from '../../../../shared/viz/schema.ts';
import type {
  Boundary,
  FeatureSpec,
  FunctionDefinitionV2,
  FunctionGraphScene,
  Parameter,
  RegionSpec,
  VizDiagnostic,
  VizDocumentV2,
} from '../../../../shared/viz/types.ts';
import type { ModeledVisualization } from '../visualize-modeler.ts';

const MODELER_VERSION = 'modeler@2.0.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function chineseNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  const digits: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (raw === '十') return 10;
  if (raw.length === 1) return digits[raw] ?? null;
  if (raw.startsWith('十')) return 10 + (digits[raw.slice(1)] ?? 0);
  if (raw.endsWith('十')) return (digits[raw[0]] ?? 0) * 10;
  const match = raw.match(/^([一二两三四五六七八九])十([一二三四五六七八九])$/);
  if (match) return (digits[match[1]] ?? 0) * 10 + (digits[match[2]] ?? 0);
  return null;
}

export function expectedRootCount(question: string): number | undefined {
  const match = question.match(/([0-9一二两三四五六七八九十]+)\s*个?\s*零点/);
  if (!match) return undefined;
  const value = chineseNumber(match[1]);
  return value !== null && value >= 0 && value <= 50 ? value : undefined;
}

function functionNameFromLabel(label: string, index: number): string {
  const match = label.match(/^([A-Za-z])\s*\(/);
  if (match && !['x', 'y', 'pi', 'e'].includes(match[1])) return match[1];
  return ['f', 'g', 'h', 'k', 'p', 'q'][index] ?? `f${index}`;
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  let index = 2;
  while (used.has(`${name}${index}`)) index += 1;
  return `${name}${index}`;
}

function defaultView(range: unknown): [number, number] {
  if (Array.isArray(range) && range.length === 2 && finite(range[0]) && finite(range[1]) && range[0] < range[1]) {
    return [range[0], range[1]];
  }
  return [-10, 10];
}

function looksPolynomial(body: string): boolean {
  return !/sin|cos|tan|abs|sqrt|log|ln|exp|floor|ceil|round/.test(body) && body.includes('x');
}

function normalizeComparisonText(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\\le(?![a-zA-Z])/g, '<=')
    .replace(/\\ge(?![a-zA-Z])/g, '>=');
}

interface ComparisonParts {
  left: string;
  op: '<' | '<=' | '>' | '>=';
  right: string;
}

function splitComparison(raw: string): ComparisonParts | null {
  const text = normalizeComparisonText(raw);
  const match = text.match(/^(.+?)(<=|>=|<|>)(.+)$/);
  if (!match) return null;
  return { left: match[1], op: match[2] as ComparisonParts['op'], right: match[3] };
}

function hasVariable(expression: string): boolean {
  return /[xy]/.test(expression);
}

function conditionAxis(expression: string): 'x' | 'y' {
  return /(^|[^A-Za-z0-9_])y([^A-Za-z0-9_]|$)/.test(expression) && !/(^|[^A-Za-z0-9_])x([^A-Za-z0-9_]|$)/.test(expression)
    ? 'y'
    : 'x';
}

function expandCustomCalls(raw: string, definitions: FunctionDefinitionV2[]): string | null {
  let output = raw;
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const definition of definitions) {
      if (definition.piecewise?.length || !definition.body) continue;
      const pattern = new RegExp(`\\b${definition.name}\\s*\\(([^()]*)\\)`, 'g');
      output = output.replace(pattern, (_match, argument: string) => {
        changed = true;
        return `(${definition.body.replace(/\bx\b/g, `(${argument})`)})`;
      });
    }
    if (!changed) break;
  }
  return output;
}

function boundaryFromSide(
  side: string,
  definitions: FunctionDefinitionV2[],
  usedNames: Set<string>,
): Boundary | null {
  const text = side.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { kind: 'constant', value: Number(text) };
  const byName = definitions.find((item) => item.name === text || item.display.startsWith(`${text}(`));
  if (byName) return { kind: 'function', def: byName.name };
  const callName = text.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(/);
  if (callName) {
    const definition = definitions.find((item) => item.name === callName[1]);
    if (definition) return { kind: 'function', def: definition.name };
  }
  if (!hasVariable(text)) return null;
  const name = uniqueName('r', usedNames);
  usedNames.add(name);
  definitions.push({
    name,
    params: ['x'],
    body: text,
    display: text,
  });
  return { kind: 'function', def: name };
}

function parseLegacyRegion(
  rawWhere: string,
  definitions: FunctionDefinitionV2[],
  usedNames: Set<string>,
  diagnostics: VizDiagnostic[],
): RegionSpec | null {
  const parts = splitComparison(rawWhere);
  if (!parts) {
    diagnostics.push({ code: 'VIZ_REGION_INVALID', severity: 'warning', message: `无法解析区域条件：${rawWhere}`, path: 'scene.regions' });
    return null;
  }
  const chained = splitComparison(parts.right);
  if (chained) {
    const middle = parts.right.slice(0, parts.right.length - chained.op.length - chained.right.length).trim();
    const expanded = expandCustomCalls(middle, definitions);
    if (expanded && hasVariable(expanded)) {
      const condition = `(${parts.left}${parts.op}${expanded})&&(${expanded}${chained.op}${chained.right})`;
      try {
        compileExpression(condition);
        return { kind: 'condition', condition, axis: conditionAxis(condition), role: 'solution' };
      } catch {
        // fall through to diagnostic
      }
    }
    diagnostics.push({ code: 'VIZ_REGION_UNSUPPORTED', severity: 'warning', message: `暂不支持链式区域条件：${rawWhere}`, path: 'scene.regions' });
    return null;
  }
  const left = boundaryFromSide(parts.left, definitions, usedNames);
  const right = boundaryFromSide(parts.right, definitions, usedNames);
  if (!left || !right) {
    diagnostics.push({ code: 'VIZ_REGION_UNSUPPORTED', severity: 'warning', message: `区域条件包含无法解析的边界：${rawWhere}`, path: 'scene.regions' });
    return null;
  }
  if (left.kind === 'constant' && right.kind === 'constant') {
    diagnostics.push({ code: 'VIZ_REGION_INVALID', severity: 'warning', message: `区域条件两边都是常量，已丢弃：${rawWhere}`, path: 'scene.regions' });
    return null;
  }
  if (left.kind === 'function' && right.kind === 'function') {
    const leftDefinition = definitions.find((item) => item.name === left.def);
    const rightDefinition = definitions.find((item) => item.name === right.def);
    const condition = leftDefinition?.body && rightDefinition?.body
      ? `(${leftDefinition.body})${parts.op}(${rightDefinition.body})`
      : null;
    if (condition) {
      try {
        compileExpression(condition);
        return { kind: 'condition', condition, axis: conditionAxis(condition), role: 'solution' };
      } catch {
        // fall through to diagnostic
      }
    }
    diagnostics.push({ code: 'VIZ_REGION_UNSUPPORTED', severity: 'warning', message: `暂不支持该区域条件：${rawWhere}`, path: 'scene.regions' });
    return null;
  }
  return parts.op === '<' || parts.op === '<='
    ? { kind: 'between', lower: left, upper: right, role: 'solution' }
    : { kind: 'between', lower: right, upper: left, role: 'solution' };
}

function parseParameters(raw: unknown, definitionNames: Set<string>): Parameter[] {
  if (!Array.isArray(raw)) return [];
  const output: Parameter[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.param === 'string' ? item.param.trim() : '';
    if (!name || seen.has(name) || definitionNames.has(name) || ['x', 'y', 'pi', 'e'].includes(name)) continue;
    if (!finite(item.min) || !finite(item.max) || item.min >= item.max) continue;
    const step = finite(item.step) && item.step > 0 ? item.step : 0.1;
    const value = finite(item.value) && item.value >= item.min && item.value <= item.max
      ? item.value
      : (item.min + item.max) / 2;
    seen.add(name);
    output.push({ name, min: item.min, max: item.max, step, value });
  }
  return output.slice(0, 6);
}

export function functionGraphDocumentFromModeled(
  modeled: ModeledVisualization,
  question: string,
  subject?: string,
  generator: 'modeler' | 'preset' | 'manual' = 'modeler',
  inputRecovered = false,
): VizDocumentV2 {
  const spec = modeled.spec;
  const rawFunctions = Array.isArray(spec.functions) && spec.functions.length
    ? spec.functions
    : [{ expression: spec.expression, label: `y=${String(spec.expression ?? '')}` }];
  const usedNames = new Set<string>();
  const definitions: FunctionDefinitionV2[] = rawFunctions.map((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const label = typeof item.label === 'string' && item.label.trim()
      ? item.label.trim()
      : `f(x)=${String(item.expression ?? '')}`;
    const name = uniqueName(functionNameFromLabel(label, index), usedNames);
    usedNames.add(name);
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
  const parameters = parseParameters(spec.sliders, names);
  const curves = definitions.map((definition, index) => ({
    def: definition.name,
    role: index === 0 ? 'primary' as const : 'secondary' as const,
    visible: true,
  }));
  const features: FeatureSpec[] = [];
  const expected = expectedRootCount(question);
  definitions.forEach((definition, index) => {
    features.push({
      kind: 'roots',
      of: [definition.name],
      ...(index === 0 && expected !== undefined ? { expected } : {}),
      limit: 20,
    });
    if (looksPolynomial(definition.body)) features.push({ kind: 'extrema', of: [definition.name], limit: 6 });
  });
  const relations = Array.isArray(spec.relations) ? spec.relations : [];
  if (relations.length && definitions.length >= 2) {
    features.push({ kind: 'intersections', of: [definitions[0].name, definitions[1].name], limit: 20 });
  }

  const diagnostics: VizDiagnostic[] = [];
  const regions: RegionSpec[] = [];
  for (const raw of Array.isArray(spec.regions) ? spec.regions : []) {
    if (!isRecord(raw) || typeof raw.where !== 'string') continue;
    const region = parseLegacyRegion(raw.where, definitions, usedNames, diagnostics);
    if (region) regions.push(region);
  }

  const view = {
    x: defaultView(spec.range),
    mode: 'auto' as const,
  };
  const scene: FunctionGraphScene = { definitions, curves, parameters, view, features, regions };
  const doc: VizDocumentV2 = {
    schema: 'edupi.viz/v2',
    kind: 'function-graph',
    title: modeled.title,
    input: { text: question, ...(subject ? { subject } : {}), ...(inputRecovered ? { recovered: true } : {}) },
    provenance: { generator, version: MODELER_VERSION, questionHash: hashText(question) },
    scene,
    diagnostics,
  };
  return validateVizDocument(doc);
}

export function conicDocumentFromModeled(
  modeled: ModeledVisualization,
  question: string,
  subject?: string,
  generator: 'modeler' | 'preset' | 'manual' = 'modeler',
  inputRecovered = false,
): VizDocumentV2 {
  const spec = modeled.spec;
  const expression = String(spec.expression ?? '');
  const label = Array.isArray(spec.functions) && isRecord(spec.functions[0]) && typeof spec.functions[0].label === 'string'
    ? spec.functions[0].label
    : expression;
  const range = defaultView(spec.range);
  const doc: VizDocumentV2 = {
    schema: 'edupi.viz/v2',
    kind: 'conic',
    title: modeled.title,
    input: { text: question, ...(subject ? { subject } : {}), ...(inputRecovered ? { recovered: true } : {}) },
    provenance: { generator, version: MODELER_VERSION, questionHash: hashText(question) },
    scene: { expression, label, view: { x: range, y: range, mode: 'auto' } },
    diagnostics: [],
  };
  return validateVizDocument(doc);
}

export function manualFunctionDocument(input: {
  expression: string;
  range?: [number, number];
  title?: string;
}): VizDocumentV2 {
  const range = defaultView(input.range ?? [-10, 10]);
  const expression = input.expression.trim();
  const rawTitle = input.title?.trim() || `函数 y=${expression}`;
  const title = rawTitle.length > 80 ? rawTitle.slice(0, 77) + '...' : rawTitle;
  const doc: VizDocumentV2 = {
    schema: 'edupi.viz/v2',
    kind: 'function-graph',
    title,
    input: { text: `y=${expression}` },
    provenance: { generator: 'manual', version: MODELER_VERSION },
    scene: {
      definitions: [{ name: 'f', params: ['x'], body: expression, display: `y=${expression}` }],
      curves: [{ def: 'f', role: 'primary', visible: true }],
      parameters: [],
      view: { x: range, mode: 'auto' },
      features: [{ kind: 'roots', of: ['f'], limit: 20 }],
      regions: [],
    },
    diagnostics: [],
  };
  return validateVizDocument(doc);
}

export function manualConicDocument(input: {
  expression: string;
  range?: [number, number];
  title?: string;
}): VizDocumentV2 {
  const range = defaultView(input.range ?? [-8, 8]);
  const expression = input.expression.trim();
  const rawTitle = input.title?.trim() || `圆锥曲线 ${expression}`;
  const title = rawTitle.length > 80 ? rawTitle.slice(0, 77) + '...' : rawTitle;
  const doc: VizDocumentV2 = {
    schema: 'edupi.viz/v2',
    kind: 'conic',
    title,
    input: { text: expression },
    provenance: { generator: 'manual', version: MODELER_VERSION },
    scene: { expression, label: expression, view: { x: range, y: range, mode: 'auto' } },
    diagnostics: [],
  };
  return validateVizDocument(doc);
}
