import { compileExpression, collectVariables, parseExpression } from '../expression';
import {
  VizPlanError,
  type AuxiliarySpec,
  type BiologyScene,
  type Boundary,
  type ConicScene,
  type CurveRef,
  type DiagramElement,
  type DiagramScene,
  type FeatureSpec,
  type FunctionDefinitionV2,
  type FunctionGraphScene,
  type MoleculeScene,
  type Parameter,
  type Point3D,
  type RegionSpec,
  type SolidGeometryScene,
  type SurfaceScene,
  type ViewSpec,
  type VizDiagnostic,
  type VizDocumentV2,
} from './types';

const FORBIDDEN_STYLE_KEYS = new Set(['fill', 'stroke', 'attr', 'color', 'style', 'opacity', 'lineWidth']);
const ALLOWED_KINDS = new Set(['function-graph', 'conic', 'function-3d', 'solid-geometry', 'molecule', 'terrain', 'biology', 'physics', 'diagram']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(code: string, message: string, path?: string): never {
  const diagnostic: VizDiagnostic = { code, severity: 'error', message, ...(path ? { path } : {}) };
  throw new VizPlanError(code, message, [diagnostic]);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertKnownKeys(raw: Record<string, unknown>, allowed: string[], path: string, code = 'VIZ_SCENE_INVALID'): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) fail(code, `场景包含未知字段 ${key}`, `${path}.${key}`);
  }
}

function textField(raw: unknown, path: string, code: string, max = 200, required = true): string {
  if (raw === undefined && !required) return '';
  if (typeof raw !== 'string' || (required && !raw.trim()) || raw.length > max) {
    fail(code, `${path.split('.').pop() || '字段'} 必须是不超过 ${max} 字的字符串`, path);
  }
  return raw.trim();
}

function colorField(raw: unknown, path: string, code: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 40) {
    fail(code, '颜色必须是不超过 40 字的字符串', path);
  }
  return raw.trim();
}

function pair(value: unknown, path: string, code: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !finite(value[0]) || !finite(value[1]) || Math.abs(value[0]) > 1e6 || Math.abs(value[1]) > 1e6) {
    fail(code, '坐标必须是两个有限数字', path);
  }
  return [value[0], value[1]];
}

function triple(value: unknown, path: string, code: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.slice(0, 3).every(finite) || value.some((item) => Math.abs(item as number) > 1e6)) {
    fail(code, '三维坐标必须是三个有限数字', path);
  }
  return [value[0], value[1], value[2]];
}

function assertNoStyleKeys(value: unknown, path: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoStyleKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_STYLE_KEYS.has(key)) {
      fail('VIZ_STYLE_FORBIDDEN', `可视化场景不能包含样式字段 ${key}`, `${path}.${key}`);
    }
    assertNoStyleKeys(child, `${path}.${key}`);
  }
}

function sameName(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function validateExpression(
  source: unknown,
  allowed: Set<string>,
  code: string,
  path: string,
  max = 500,
): string {
  if (typeof source !== 'string' || !source.trim() || source.length > max) {
    fail(code, '表达式不能为空且不能超过长度限制', path);
  }
  const text = source.trim();
  try {
    const node = parseExpression(text);
    compileExpression(text);
    for (const name of collectVariables(node)) {
      if (!allowed.has(name)) fail(code, `表达式包含未知变量：${name}`, path);
    }
  } catch (error) {
    if (error instanceof VizPlanError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    fail(code, `表达式无法解析：${reason}`, path);
  }
  return text;
}

function validateView(raw: unknown, path: string): ViewSpec {
  if (!isRecord(raw)) fail('VIZ_VIEW_INVALID', 'view 必须是对象', path);
  const x = raw.x;
  if (!Array.isArray(x) || x.length !== 2 || !finite(x[0]) || !finite(x[1]) || x[0] >= x[1]) {
    fail('VIZ_VIEW_INVALID', 'view.x 必须是 [min,max] 且 min < max', `${path}.x`);
  }
  if (Math.abs(x[0]) > 1e6 || Math.abs(x[1]) > 1e6) {
    fail('VIZ_VIEW_INVALID', 'view.x 超出允许范围', `${path}.x`);
  }
  const y = raw.y;
  let viewY: [number, number] | undefined;
  if (y !== undefined) {
    if (!Array.isArray(y) || y.length !== 2 || !finite(y[0]) || !finite(y[1]) || y[0] >= y[1]) {
      fail('VIZ_VIEW_INVALID', 'view.y 必须是 [min,max] 且 min < max', `${path}.y`);
    }
    if (Math.abs(y[0]) > 1e6 || Math.abs(y[1]) > 1e6) {
      fail('VIZ_VIEW_INVALID', 'view.y 超出允许范围', `${path}.y`);
    }
    viewY = [y[0], y[1]];
  }
  const mode = raw.mode;
  if (mode !== undefined && mode !== 'auto' && mode !== 'fixed') {
    fail('VIZ_VIEW_INVALID', 'view.mode 只能是 auto/fixed', `${path}.mode`);
  }
  return { x: [x[0], x[1]], ...(viewY ? { y: viewY } : {}), mode: mode === 'fixed' ? 'fixed' : 'auto' };
}

function validateDefinition(raw: unknown, path: string, functionNames: Set<string>, parameterNames: Set<string>): FunctionDefinitionV2 {
  if (!isRecord(raw)) fail('VIZ_DEFINITION_INVALID', '函数定义必须是对象', path);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    fail('VIZ_DEFINITION_INVALID', `函数名不合法：${name || '(空)'}`, `${path}.name`);
  }
  const params = raw.params;
  if (!Array.isArray(params) || params.length !== 1 || typeof params[0] !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(params[0])) {
    fail('VIZ_DEFINITION_INVALID', '目前只支持一个参数', `${path}.params`);
  }
  const display = typeof raw.display === 'string' ? raw.display.trim() : '';
  if (!display || display.length > 200) {
    fail('VIZ_DEFINITION_INVALID', 'display 不能为空且不能超过 200 字', `${path}.display`);
  }
  const allowed = new Set([params[0], 'x', 'pi', 'e', ...functionNames, ...parameterNames]);
  const piecewiseRaw = raw.piecewise;
  let piecewise: { when: string; then: string }[] | undefined;
  if (piecewiseRaw !== undefined) {
    if (!Array.isArray(piecewiseRaw) || piecewiseRaw.length < 1 || piecewiseRaw.length > 20) {
      fail('VIZ_PIECEWISE_INVALID', 'piecewise 必须是 1~20 个分支', `${path}.piecewise`);
    }
    piecewise = piecewiseRaw.map((branch, index) => {
      if (!isRecord(branch)) fail('VIZ_PIECEWISE_INVALID', 'piecewise 分支必须是对象', `${path}.piecewise[${index}]`);
      return {
        when: validateExpression(branch.when, allowed, 'VIZ_PIECEWISE_INVALID', `${path}.piecewise[${index}].when`),
        then: validateExpression(branch.then, allowed, 'VIZ_PIECEWISE_INVALID', `${path}.piecewise[${index}].then`),
      };
    });
  }
  let body = '';
  if (typeof raw.body === 'string' && raw.body.trim()) {
    body = validateExpression(raw.body, allowed, 'VIZ_EXPRESSION_INVALID', `${path}.body`);
  }
  if (!body && !piecewise) {
    fail('VIZ_DEFINITION_INVALID', '函数定义需要 body 或 piecewise', path);
  }
  const domainRaw = raw.domain;
  let domain: [number, number] | undefined;
  if (domainRaw !== undefined) {
    if (!Array.isArray(domainRaw) || domainRaw.length !== 2 || !finite(domainRaw[0]) || !finite(domainRaw[1]) || domainRaw[0] >= domainRaw[1]) {
      fail('VIZ_DEFINITION_INVALID', 'domain 必须是 [min,max] 且 min < max', `${path}.domain`);
    }
    domain = [domainRaw[0], domainRaw[1]];
  }
  return { name, params: [params[0]], body, display, ...(piecewise ? { piecewise } : {}), ...(domain ? { domain } : {}) };
}

function validateCurve(raw: unknown, path: string, names: Set<string>): CurveRef {
  if (!isRecord(raw)) fail('VIZ_CURVE_INVALID', 'curve 必须是对象', path);
  const def = typeof raw.def === 'string' ? raw.def.trim() : '';
  if (!names.has(def)) fail('VIZ_CURVE_INVALID', `curve 引用了不存在的函数：${def}`, `${path}.def`);
  const role = raw.role;
  if (role !== 'primary' && role !== 'secondary' && role !== 'reference') {
    fail('VIZ_CURVE_INVALID', 'curve.role 必须是 primary/secondary/reference', `${path}.role`);
  }
  return { def, role, visible: raw.visible !== false };
}

function validateParameter(raw: unknown, path: string): Parameter {
  if (!isRecord(raw)) fail('VIZ_PARAMETER_INVALID', 'parameter 必须是对象', path);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || ['x', 'y', 'pi', 'e'].includes(name)) {
    fail('VIZ_PARAMETER_INVALID', `参数名不合法：${name || '(空)'}`, `${path}.name`);
  }
  if (!finite(raw.min) || !finite(raw.max) || raw.min >= raw.max) {
    fail('VIZ_PARAMETER_INVALID', 'parameter 需要 min < max', path);
  }
  if (!finite(raw.step) || raw.step <= 0) fail('VIZ_PARAMETER_INVALID', 'parameter.step 必须大于 0', `${path}.step`);
  if (!finite(raw.value) || raw.value < raw.min || raw.value > raw.max) {
    fail('VIZ_PARAMETER_INVALID', 'parameter.value 必须在 [min,max] 内', `${path}.value`);
  }
  return { name, min: raw.min, max: raw.max, step: raw.step, value: raw.value };
}

function validateBoundary(raw: unknown, path: string, names: Set<string>): Boundary {
  if (!isRecord(raw)) fail('VIZ_REGION_INVALID', 'region boundary 必须是对象', path);
  if (raw.kind === 'constant') {
    if (!finite(raw.value)) fail('VIZ_REGION_INVALID', '常量边界需要有限数字', `${path}.value`);
    return { kind: 'constant', value: raw.value };
  }
  if (raw.kind === 'function') {
    const def = typeof raw.def === 'string' ? raw.def.trim() : '';
    if (!names.has(def)) fail('VIZ_REGION_INVALID', `region 引用了不存在的函数：${def}`, `${path}.def`);
    return { kind: 'function', def };
  }
  fail('VIZ_REGION_INVALID', 'region boundary.kind 只能是 constant/function', `${path}.kind`);
}

function validateFeature(raw: unknown, path: string, names: Set<string>): FeatureSpec {
  if (!isRecord(raw)) fail('VIZ_FEATURE_INVALID', 'feature 必须是对象', path);
  const kind = raw.kind;
  if (kind === 'roots' || kind === 'extrema' || kind === 'endpoints') {
    const of = raw.of;
    if (!Array.isArray(of) || of.length < 1 || of.length > 6 || !of.every((name) => typeof name === 'string' && names.has(name))) {
      fail('VIZ_FEATURE_INVALID', 'feature.of 必须是已定义的函数名数组', `${path}.of`);
    }
    if (kind === 'roots') {
      const expected = raw.expected;
      if (expected !== undefined && (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0 || expected > 50)) {
        fail('VIZ_FEATURE_INVALID', 'roots.expected 必须是 0~50 的整数', `${path}.expected`);
      }
      const limit = raw.limit;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50)) {
        fail('VIZ_FEATURE_INVALID', 'roots.limit 必须是 1~50 的整数', `${path}.limit`);
      }
      return {
        kind,
        of,
        ...(typeof expected === 'number' ? { expected } : {}),
        ...(typeof limit === 'number' ? { limit } : {}),
      };
    }
    return { kind, of };
  }
  if (kind === 'intersections') {
    const of = raw.of;
    if (!Array.isArray(of) || of.length !== 2 || !of.every((name) => typeof name === 'string' && names.has(name))) {
      fail('VIZ_FEATURE_INVALID', 'intersections.of 必须是两个已定义函数名', `${path}.of`);
    }
    const limit = raw.limit;
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50)) {
      fail('VIZ_FEATURE_INVALID', 'intersections.limit 必须是 1~50 的整数', `${path}.limit`);
    }
    return { kind, of: [of[0], of[1]], ...(typeof limit === 'number' ? { limit } : {}) };
  }
  fail('VIZ_FEATURE_INVALID', 'feature.kind 不受支持', `${path}.kind`);
}

function validateRegion(raw: unknown, path: string, names: Set<string>, params: Set<string>): RegionSpec {
  if (!isRecord(raw)) fail('VIZ_REGION_INVALID', 'region 必须是对象', path);
  if (raw.kind === 'between') {
    const lower = validateBoundary(raw.lower, `${path}.lower`, names);
    const upper = validateBoundary(raw.upper, `${path}.upper`, names);
    if (lower.kind === 'constant' && upper.kind === 'constant') {
      fail('VIZ_REGION_INVALID', '区域上下边界不能同时是常量', path);
    }
    return { kind: 'between', lower, upper, role: 'solution' };
  }
  if (raw.kind === 'condition') {
    if (raw.axis !== undefined && raw.axis !== 'x' && raw.axis !== 'y') {
      fail('VIZ_REGION_INVALID', 'region.axis 只能是 x 或 y', `${path}.axis`);
    }
    const axis = raw.axis === 'y' ? 'y' : 'x';
    const allowed = new Set([axis, 'pi', 'e', ...params]);
    const condition = validateExpression(raw.condition, allowed, 'VIZ_REGION_INVALID', `${path}.condition`);
    return { kind: 'condition', condition, axis, role: 'solution' };
  }
  fail('VIZ_REGION_INVALID', 'region.kind 只能是 between/condition', `${path}.kind`);
}

function validateFunctionGraphScene(raw: unknown, path: string): FunctionGraphScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'function-graph scene 必须是对象', path);
  assertNoStyleKeys(raw, path);
  const parametersRaw = raw.parameters ?? [];
  if (!Array.isArray(parametersRaw) || parametersRaw.length > 6) {
    fail('VIZ_PARAMETER_INVALID', 'parameters 必须是不超过 6 项的数组', `${path}.parameters`);
  }
  const parameters = parametersRaw.map((item, index) => validateParameter(item, `${path}.parameters[${index}]`));
  const parameterNames = new Set(parameters.map((item) => item.name));
  if (parameterNames.size !== parameters.length) fail('VIZ_PARAMETER_INVALID', '参数名不能重复', `${path}.parameters`);
  const definitionsRaw = raw.definitions;
  if (!Array.isArray(definitionsRaw) || definitionsRaw.length < 1 || definitionsRaw.length > 6) {
    fail('VIZ_DEFINITION_INVALID', 'definitions 必须是 1~6 个函数', `${path}.definitions`);
  }
  const names = new Set<string>();
  const definitions = definitionsRaw.map((item, index) => {
    const definition = validateDefinition(item, `${path}.definitions[${index}]`, names, parameterNames);
    if (names.has(definition.name)) fail('VIZ_DEFINITION_INVALID', `函数名重复：${definition.name}`, `${path}.definitions[${index}]`);
    names.add(definition.name);
    return definition;
  });
  const curvesRaw = raw.curves;
  if (!Array.isArray(curvesRaw) || curvesRaw.length < 1 || curvesRaw.length > 6) {
    fail('VIZ_CURVE_INVALID', 'curves 必须是 1~6 项', `${path}.curves`);
  }
  const curves = curvesRaw.map((item, index) => validateCurve(item, `${path}.curves[${index}]`, names));
  const view = validateView(raw.view, `${path}.view`);
  const featuresRaw = raw.features ?? [];
  if (!Array.isArray(featuresRaw) || featuresRaw.length > 20) {
    fail('VIZ_FEATURE_INVALID', 'features 必须是不超过 20 项的数组', `${path}.features`);
  }
  const features = featuresRaw.map((item, index) => validateFeature(item, `${path}.features[${index}]`, names));
  const regionsRaw = raw.regions ?? [];
  if (!Array.isArray(regionsRaw) || regionsRaw.length > 10) {
    fail('VIZ_REGION_INVALID', 'regions 必须是不超过 10 项的数组', `${path}.regions`);
  }
  const regions = regionsRaw.map((item, index) => validateRegion(item, `${path}.regions[${index}]`, names, parameterNames));
  return { definitions, curves, parameters, view, features, regions };
}

function validateConicScene(raw: unknown, path: string): ConicScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'conic scene 必须是对象', path);
  assertNoStyleKeys(raw, path);
  const expression = validateExpression(raw.expression, new Set(['x', 'y', 'pi', 'e']), 'VIZ_EXPRESSION_INVALID', `${path}.expression`);
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : expression;
  if (label.length > 200) fail('VIZ_LABEL_INVALID', 'label 不能超过 200 字', `${path}.label`);
  const view = validateView(raw.view, `${path}.view`);
  return { expression, label, view };
}


function validateSolidGeometryScene(raw: unknown, path: string): SolidGeometryScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'solid-geometry scene 必须是对象', path);
  assertKnownKeys(raw, ['points', 'edges', 'faces', 'auxiliary', 'labels'], path);
  const pointsRaw = raw.points;
  if (!Array.isArray(pointsRaw) || pointsRaw.length < 1 || pointsRaw.length > 300) {
    fail('VIZ_GEOMETRY_INVALID', 'points 必须是 1~300 项', `${path}.points`);
  }
  const ids = new Set<string>();
  const points: Point3D[] = pointsRaw.map((item, index) => {
    if (!isRecord(item)) fail('VIZ_GEOMETRY_INVALID', 'point 必须是对象', `${path}.points[${index}]`);
    assertKnownKeys(item, ['id', 'coord'], `${path}.points[${index}]`, 'VIZ_GEOMETRY_INVALID');
    const id = textField(item.id, `${path}.points[${index}].id`, 'VIZ_GEOMETRY_INVALID', 32);
    if (ids.has(id)) fail('VIZ_GEOMETRY_INVALID', `点编号重复：${id}`, `${path}.points[${index}].id`);
    ids.add(id);
    return { id, coord: triple(item.coord, `${path}.points[${index}].coord`, 'VIZ_GEOMETRY_INVALID') };
  });
  const edgesRaw = raw.edges ?? [];
  if (!Array.isArray(edgesRaw) || edgesRaw.length > 600) fail('VIZ_GEOMETRY_INVALID', 'edges 必须是不超过 600 项的数组', `${path}.edges`);
  const edges: [string, string][] = edgesRaw.map((item, index) => {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string' || !ids.has(item[0]) || !ids.has(item[1])) {
      fail('VIZ_GEOMETRY_INVALID', 'edge 必须引用两个已定义的点', `${path}.edges[${index}]`);
    }
    return [item[0], item[1]];
  });
  const facesRaw = raw.faces ?? [];
  if (!Array.isArray(facesRaw) || facesRaw.length > 300) fail('VIZ_GEOMETRY_INVALID', 'faces 必须是不超过 300 项的数组', `${path}.faces`);
  const faces: string[][] = facesRaw.map((item, index) => {
    if (!Array.isArray(item) || item.length < 3 || item.length > 12 || !item.every((id) => typeof id === 'string' && ids.has(id))) {
      fail('VIZ_GEOMETRY_INVALID', 'face 必须引用至少三个已定义的点', `${path}.faces[${index}]`);
    }
    return item.slice();
  });
  const auxiliaryRaw = raw.auxiliary ?? [];
  if (!Array.isArray(auxiliaryRaw) || auxiliaryRaw.length > 60) fail('VIZ_GEOMETRY_INVALID', 'auxiliary 必须是不超过 60 项的数组', `${path}.auxiliary`);
  const auxiliary: AuxiliarySpec[] = auxiliaryRaw.map((item, index) => {
    const itemPath = `${path}.auxiliary[${index}]`;
    if (!isRecord(item)) fail('VIZ_GEOMETRY_INVALID', 'auxiliary 每项必须是对象', itemPath);
    assertKnownKeys(item, ['kind', 'points', 'style', 'reason'], itemPath, 'VIZ_GEOMETRY_INVALID');
    if (item.kind !== 'plane' && item.kind !== 'line' && item.kind !== 'perpendicular' && item.kind !== 'mark') {
      fail('VIZ_GEOMETRY_INVALID', 'auxiliary.kind 不受支持', `${itemPath}.kind`);
    }
    if (!Array.isArray(item.points) || item.points.length < 1 || item.points.length > 12 || !item.points.every((id) => typeof id === 'string' && ids.has(id))) {
      fail('VIZ_GEOMETRY_INVALID', 'auxiliary.points 必须引用已定义的点', `${itemPath}.points`);
    }
    let style: AuxiliarySpec['style'];
    if (item.style !== undefined) {
      if (!isRecord(item.style)) fail('VIZ_GEOMETRY_INVALID', 'auxiliary.style 必须是对象', `${itemPath}.style`);
      assertKnownKeys(item.style, ['color', 'opacity', 'dash'], `${itemPath}.style`, 'VIZ_GEOMETRY_INVALID');
      style = {
        ...(item.style.color !== undefined ? { color: colorField(item.style.color, `${itemPath}.style.color`, 'VIZ_GEOMETRY_INVALID') } : {}),
        ...(item.style.opacity !== undefined
          ? (finite(item.style.opacity) && item.style.opacity >= 0 && item.style.opacity <= 1
              ? { opacity: item.style.opacity }
              : fail('VIZ_GEOMETRY_INVALID', 'auxiliary.style.opacity 必须在 0~1 内', `${itemPath}.style.opacity`))
          : {}),
        ...(item.style.dash !== undefined
          ? (typeof item.style.dash === 'boolean'
              ? { dash: item.style.dash }
              : fail('VIZ_GEOMETRY_INVALID', 'auxiliary.style.dash 必须是布尔值', `${itemPath}.style.dash`))
          : {}),
      };
    }
    return {
      kind: item.kind,
      points: item.points.slice() as string[],
      ...(style ? { style } : {}),
      ...(item.reason !== undefined ? { reason: textField(item.reason, `${itemPath}.reason`, 'VIZ_GEOMETRY_INVALID', 200) } : {}),
    };
  });
  if (raw.labels !== undefined && typeof raw.labels !== 'boolean') fail('VIZ_GEOMETRY_INVALID', 'labels 必须是布尔值', `${path}.labels`);
  return { points, edges, faces, auxiliary, labels: raw.labels !== false };
}

function validateMoleculeScene(raw: unknown, path: string): MoleculeScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'molecule scene 必须是对象', path);
  assertKnownKeys(raw, ['format', 'style', 'data'], path);
  const format = raw.format ?? 'xyz';
  if (format !== 'xyz' && format !== 'sdf' && format !== 'mol') fail('VIZ_MOLECULE_INVALID', 'format 只能是 xyz/sdf/mol', `${path}.format`);
  const style = raw.style ?? 'stick';
  if (style !== 'stick' && style !== 'sphere' && style !== 'line') fail('VIZ_MOLECULE_INVALID', 'style 只能是 stick/sphere/line', `${path}.style`);
  if (typeof raw.data !== 'string' || !raw.data.trim() || raw.data.length > 50000) {
    fail('VIZ_MOLECULE_INVALID', 'data 必须是 1~50000 字的分子结构文本', `${path}.data`);
  }
  return { format, style, data: raw.data };
}

function validateSurfaceScene(raw: unknown, path: string): SurfaceScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'surface scene 必须是对象', path);
  assertKnownKeys(raw, ['expression', 'grid', 'range'], path);
  const rangeRaw = raw.range ?? [-6, 6];
  if (!Array.isArray(rangeRaw) || rangeRaw.length !== 2 || !finite(rangeRaw[0]) || !finite(rangeRaw[1]) || rangeRaw[0] >= rangeRaw[1]) {
    fail('VIZ_SURFACE_INVALID', 'range 必须是 [min,max] 且 min < max', `${path}.range`);
  }
  let expression: string | undefined;
  if (raw.expression !== undefined) {
    expression = validateExpression(raw.expression, new Set(['x', 'y', 'pi', 'e']), 'VIZ_SURFACE_INVALID', `${path}.expression`);
  }
  let grid: number[][] | undefined;
  if (raw.grid !== undefined) {
    if (!Array.isArray(raw.grid) || raw.grid.length < 2 || raw.grid.length > 200) {
      fail('VIZ_SURFACE_INVALID', 'grid 必须是 2~200 行', `${path}.grid`);
    }
    const width = Array.isArray(raw.grid[0]) ? raw.grid[0].length : 0;
    if (width < 2 || width > 200) fail('VIZ_SURFACE_INVALID', 'grid 每行必须有 2~200 个数字', `${path}.grid`);
    grid = raw.grid.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== width || !row.every((value) => finite(value) && Math.abs(value) <= 1e9)) {
        fail('VIZ_SURFACE_INVALID', 'grid 必须是等宽有限数字矩阵', `${path}.grid[${rowIndex}]`);
      }
      return row.slice();
    });
  }
  if (!expression && !grid) fail('VIZ_SURFACE_INVALID', 'surface scene 需要 expression 或 grid', path);
  return { ...(expression ? { expression } : {}), ...(grid ? { grid } : {}), range: [rangeRaw[0], rangeRaw[1]] };
}

function validateBiologyScene(raw: unknown, path: string): BiologyScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'biology scene 必须是对象', path);
  assertKnownKeys(raw, ['parts'], path);
  if (!Array.isArray(raw.parts) || raw.parts.length < 1 || raw.parts.length > 80) {
    fail('VIZ_BIOLOGY_INVALID', 'parts 必须是 1~80 项', `${path}.parts`);
  }
  const ids = new Set<string>();
  const parts = raw.parts.map((item, index) => {
    const itemPath = `${path}.parts[${index}]`;
    if (!isRecord(item)) fail('VIZ_BIOLOGY_INVALID', 'part 必须是对象', itemPath);
    assertKnownKeys(item, ['id', 'label', 'coord', 'radius', 'color'], itemPath, 'VIZ_BIOLOGY_INVALID');
    const id = textField(item.id, `${itemPath}.id`, 'VIZ_BIOLOGY_INVALID', 32);
    if (ids.has(id)) fail('VIZ_BIOLOGY_INVALID', `结构编号重复：${id}`, `${itemPath}.id`);
    ids.add(id);
    if (!finite(item.radius) || item.radius <= 0 || item.radius > 100) fail('VIZ_BIOLOGY_INVALID', 'radius 必须在 (0,100] 内', `${itemPath}.radius`);
    return {
      id,
      label: textField(item.label, `${itemPath}.label`, 'VIZ_BIOLOGY_INVALID', 80),
      coord: triple(item.coord, `${itemPath}.coord`, 'VIZ_BIOLOGY_INVALID'),
      radius: item.radius,
      color: colorField(item.color, `${itemPath}.color`, 'VIZ_BIOLOGY_INVALID'),
    };
  });
  return { parts };
}

function validateDiagramScene(raw: unknown, path: string): DiagramScene {
  if (!isRecord(raw)) fail('VIZ_SCENE_INVALID', 'diagram scene 必须是对象', path);
  assertKnownKeys(raw, ['elements'], path);
  if (!Array.isArray(raw.elements) || raw.elements.length < 1 || raw.elements.length > 300) {
    fail('VIZ_DIAGRAM_INVALID', 'elements 必须是 1~300 项', `${path}.elements`);
  }
  const elements: DiagramElement[] = raw.elements.map((item, index) => {
    const itemPath = `${path}.elements[${index}]`;
    if (!isRecord(item)) fail('VIZ_DIAGRAM_INVALID', 'element 必须是对象', itemPath);
    const kind = item.kind;
    if (kind === 'line' || kind === 'arrow') {
      assertKnownKeys(item, ['kind', 'from', 'to', 'label', 'color'], itemPath, 'VIZ_DIAGRAM_INVALID');
      return {
        kind,
        from: pair(item.from, `${itemPath}.from`, 'VIZ_DIAGRAM_INVALID'),
        to: pair(item.to, `${itemPath}.to`, 'VIZ_DIAGRAM_INVALID'),
        ...(item.label !== undefined ? { label: textField(item.label, `${itemPath}.label`, 'VIZ_DIAGRAM_INVALID', 120) } : {}),
        ...(item.color !== undefined ? { color: colorField(item.color, `${itemPath}.color`, 'VIZ_DIAGRAM_INVALID') } : {}),
      };
    }
    if (kind === 'rect') {
      assertKnownKeys(item, ['kind', 'x', 'y', 'w', 'h', 'label', 'rotate', 'color'], itemPath, 'VIZ_DIAGRAM_INVALID');
      if (!finite(item.x) || !finite(item.y) || !finite(item.w) || !finite(item.h) || item.w <= 0 || item.h <= 0) {
        fail('VIZ_DIAGRAM_INVALID', 'rect 需要有限的 x/y/w/h，且 w/h 大于 0', itemPath);
      }
      if (item.rotate !== undefined && !finite(item.rotate)) fail('VIZ_DIAGRAM_INVALID', 'rect.rotate 必须是有限数字', `${itemPath}.rotate`);
      return {
        kind,
        x: item.x, y: item.y, w: item.w, h: item.h,
        ...(item.label !== undefined ? { label: textField(item.label, `${itemPath}.label`, 'VIZ_DIAGRAM_INVALID', 120) } : {}),
        ...(item.rotate !== undefined ? { rotate: item.rotate } : {}),
        ...(item.color !== undefined ? { color: colorField(item.color, `${itemPath}.color`, 'VIZ_DIAGRAM_INVALID') } : {}),
      };
    }
    if (kind === 'circle') {
      assertKnownKeys(item, ['kind', 'x', 'y', 'r', 'label', 'color'], itemPath, 'VIZ_DIAGRAM_INVALID');
      if (!finite(item.x) || !finite(item.y) || !finite(item.r) || item.r <= 0) {
        fail('VIZ_DIAGRAM_INVALID', 'circle 需要有限的 x/y/r，且 r 大于 0', itemPath);
      }
      return {
        kind,
        x: item.x, y: item.y, r: item.r,
        ...(item.label !== undefined ? { label: textField(item.label, `${itemPath}.label`, 'VIZ_DIAGRAM_INVALID', 120) } : {}),
        ...(item.color !== undefined ? { color: colorField(item.color, `${itemPath}.color`, 'VIZ_DIAGRAM_INVALID') } : {}),
      };
    }
    if (kind === 'text') {
      assertKnownKeys(item, ['kind', 'x', 'y', 'text', 'color'], itemPath, 'VIZ_DIAGRAM_INVALID');
      if (!finite(item.x) || !finite(item.y)) fail('VIZ_DIAGRAM_INVALID', 'text 需要有限的 x/y', itemPath);
      return {
        kind,
        x: item.x, y: item.y,
        text: textField(item.text, `${itemPath}.text`, 'VIZ_DIAGRAM_INVALID', 300),
        ...(item.color !== undefined ? { color: colorField(item.color, `${itemPath}.color`, 'VIZ_DIAGRAM_INVALID') } : {}),
      };
    }
    fail('VIZ_DIAGRAM_INVALID', 'element.kind 只能是 line/arrow/rect/circle/text', `${itemPath}.kind`);
  });
  return { elements };
}

export function validateVizDocument(raw: unknown): VizDocumentV2 {
  if (!isRecord(raw)) fail('VIZ_SPEC_INVALID', 'spec 必须是对象');
  const doc = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (doc.schema !== 'edupi.viz/v2') fail('VIZ_SCHEMA_INVALID', 'schema 必须是 edupi.viz/v2');
  const kind = doc.kind;
  if (typeof kind !== 'string' || !ALLOWED_KINDS.has(kind)) {
    fail('VIZ_SCHEMA_KIND_UNSUPPORTED', `v2 暂不支持该类型：${String(kind)}`);
  }
  const title = typeof doc.title === 'string' ? doc.title.trim() : '';
  if (!title || title.length > 80) fail('VIZ_TITLE_INVALID', '标题不能为空且不超过 80 字');
  const input = isRecord(doc.input) ? doc.input : null;
  if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) {
    fail('VIZ_INPUT_INVALID', 'input.text 必须是 1~2000 字');
  }
  const provenance = isRecord(doc.provenance) ? doc.provenance : null;
  if (!provenance || !['modeler', 'manual', 'preset'].includes(String(provenance.generator))) {
    fail('VIZ_PROVENANCE_INVALID', 'provenance.generator 只能是 modeler/manual/preset');
  }
  if (typeof provenance.version !== 'string' || !provenance.version.trim()) {
    fail('VIZ_PROVENANCE_INVALID', 'provenance.version 不能为空');
  }
  const diagnostics = Array.isArray(doc.diagnostics) ? (doc.diagnostics as VizDiagnostic[]) : [];
  const scene = kind === 'function-graph'
    ? validateFunctionGraphScene(doc.scene, 'scene')
    : kind === 'conic'
      ? validateConicScene(doc.scene, 'scene')
      : kind === 'solid-geometry'
        ? validateSolidGeometryScene(doc.scene, 'scene')
        : kind === 'molecule'
          ? validateMoleculeScene(doc.scene, 'scene')
          : kind === 'function-3d' || kind === 'terrain'
            ? validateSurfaceScene(doc.scene, 'scene')
            : kind === 'biology'
              ? validateBiologyScene(doc.scene, 'scene')
              : validateDiagramScene(doc.scene, 'scene');
  return {
    schema: 'edupi.viz/v2',
    kind: kind as VizDocumentV2['kind'],
    title,
    input: {
      text: input.text,
      ...(typeof input.subject === 'string' ? { subject: input.subject } : {}),
      ...(input.recovered === true ? { recovered: true } : {}),
    },
    provenance: {
      generator: provenance.generator as VizDocumentV2['provenance']['generator'],
      version: provenance.version,
      ...(typeof provenance.questionHash === 'string' ? { questionHash: provenance.questionHash } : {}),
    },
    scene,
    diagnostics,
  };
}
