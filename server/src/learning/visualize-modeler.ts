import type { VisualizationType } from './visualize.ts';
import {
  collectVariables,
  parseExpression,
  serializeExpression,
  substituteFunctions,
  substituteVariables,
  type ExprNode,
  type FunctionDefinition,
} from '../../../shared/expression.ts';

export interface ModeledVisualization {
  type: VisualizationType;
  title: string;
  spec: Record<string, unknown>;
  basis: string;
}

const FUNCTIONS = ['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'ln', 'exp'];

function clampText(text: string, max = 80): string {
  return text.trim().slice(0, max);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(input: string): string {
  return input
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，、]/g, ',')
    .replace(/[。；]/g, ';')
    .replace(/[：]/g, ':')
    .replace(/[－—–−]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[×·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/[≠]/g, '!=')
    .replace(/[π]/g, 'pi')
    .replace(/[√]/g, 'sqrt')
    .replace(/[₀]/g, '0')
    .replace(/[₁]/g, '1')
    .replace(/[₂]/g, '2')
    .replace(/[₃]/g, '3')
    .replace(/[₄]/g, '4')
    .replace(/[²]/g, '^2')
    .replace(/[³]/g, '^3')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExpression(raw: string): string {
  let text = normalizeText(raw)
    .replace(/\\left|\\right/g, '')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\pi/g, 'pi')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\le(?![a-zA-Z])/g, '<=')
    .replace(/\\ge(?![a-zA-Z])/g, '>=')
    .replace(/[{}]/g, '')
    .replace(/\|([^|]+)\|/g, 'abs($1)')
    // 只去掉函数名与括号之间的空白，不插入乘号
    .replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '$1(')
    // 数字后接字母/括号，补乘号：2x、2(x+1)
    .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')
    // 右括号后接字母/数字/左括号，补乘号：g(x)g(、)(、)2
    .replace(/\)\s*([a-zA-Z0-9(])/g, ')*$1')
    .replace(/[^a-zA-Z0-9+\-*/^().,<>=!]/g, '')
    .replace(/\s+/g, '');
  text = text.replace(/^=+/, '').replace(/=+$/, '');
  return text;
}

function hasVariable(expression: string): boolean {
  return /[xy]/.test(expression);
}

function splitExpression(raw: string): string {
  const cleaned = normalizeText(raw)
    .split(/,|;|和|与|及|的图像|的图象|的顶点|的零点|的对称轴|在区间|求|画|作出|判断/)[0]
    .trim();
  return normalizeExpression(cleaned);
}

function extractInterval(question: string): [number, number] | null {
  const match = normalizeText(question).match(/\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  return [min, max];
}

function autoRange(expression: string): [number, number] {
  if (/sin|cos|tan/.test(expression)) return [-6.283, 6.283];
  if (/abs/.test(expression)) return [-8, 8];
  if (/sqrt|log|ln/.test(expression)) return [0, 12];
  const quadratic = expression.match(/^(-?\d*\.?\d*)\*?x\^2([+-]\d*\.?\d*)?\*?x?([+-]\d*\.?\d*)?$/);
  if (quadratic) {
    const a = quadratic[1] === '' || quadratic[1] === '+' ? 1 : quadratic[1] === '-' ? -1 : Number(quadratic[1]);
    const b = quadratic[2] === undefined ? 0 : Number(quadratic[2]);
    const c = quadratic[3] === undefined ? 0 : Number(quadratic[3]);
    if (Number.isFinite(a) && a !== 0) {
      const vertex = -b / (2 * a);
      const discriminant = b * b - 4 * a * c;
      const roots = discriminant >= 0 ? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)] : [];
      const values = [vertex, ...roots];
      return [Math.floor(Math.min(...values) - 3), Math.ceil(Math.max(...values) + 3)];
    }
  }
  return [-10, 10];
}

interface FunctionDefinitionSource {
  name: string;
  param: string;
  body: string;
  displayName?: string;
  piecewise?: { when: string; then: string }[];
}

interface ParsedFunction {
  name: string;
  param: string;
  expression: string;
  piecewise?: { when: string; then: string }[];
  label: string;
  sliders: Record<string, unknown>[];
}

function cutFunctionBody(raw: string): string {
  const text = raw.trim();
  const casesStart = text.indexOf('\\begin{cases}');
  if (casesStart >= 0) {
    const casesEnd = text.indexOf('\\end{cases}', casesStart);
    if (casesEnd >= 0) return text.slice(0, casesEnd + '\\end{cases}'.length).trim();
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === ',' || char === ';')) return text.slice(0, index).trim();
    else if (depth === 0 && /^的(图像|图象|顶点|零点|对称轴|交点)/.test(text.slice(index))) {
      return text.slice(0, index).trim();
    }
    else if (depth === 0 && /^[与和及]/.test(text.slice(index))) {
      return text.slice(0, index).trim();
    }
  }
  return text;
}

function normalizeCondition(raw: string): string {
  const text = normalizeText(raw)
    .replace(/\\le(?![a-zA-Z])/g, '<=')
    .replace(/\\ge(?![a-zA-Z])/g, '>=')
    .replace(/\\lt(?![a-zA-Z])/g, '<')
    .replace(/\\gt(?![a-zA-Z])/g, '>')
    .replace(/\s+/g, '');
  const chain = text.match(/^(.+?)(<=|<|>=|>)(.+?)(<=|<|>=|>)(.+)$/);
  if (chain) {
    const [, left, op1, middle, op2, right] = chain;
    return `${left}${op1}${middle}&&${middle}${op2}${right}`;
  }
  return text;
}

function parseCases(raw: string): { when: string; then: string }[] {
  const start = raw.indexOf('\\begin{cases}');
  const end = raw.indexOf('\\end{cases}');
  if (start < 0 || end < 0 || end <= start) throw new Error('分段函数缺少 \\begin{cases} 或 \\end{cases}');
  let body = raw.slice(start + '\\begin{cases}'.length, end);
  body = body.replace(/\\\\\[\s*\d+(?:\.\d+)?\s*(?:pt|ex|em|mm)\s*\]/g, '\\\\');
  const rows = body.split(/\\\\/).map((row) => row.trim()).filter(Boolean);
  if (rows.length === 0) throw new Error('分段函数没有分支');
  return rows.map((row) => {
    const cleaned = row.replace(/^\[\s*\d+(?:\.\d+)?\s*(?:pt|ex|em|mm)\s*\]/, '').trim();
    const separator = cleaned.search(/[,&]/);
    if (separator < 0) throw new Error('分段函数每行必须是“表达式, 条件”');
    const thenRaw = cleaned.slice(0, separator).trim();
    const whenRaw = cleaned.slice(separator + 1).trim().replace(/^&\s*/, '');
    const then = normalizeExpression(thenRaw);
    const when = normalizeCondition(whenRaw);
    if (!then || !when) throw new Error('分段函数分支为空');
    parseExpression(then);
    parseExpression(when);
    return { when, then };
  });
}

function findFunctionDefinitions(question: string): FunctionDefinitionSource[] {
  const text = normalizeText(question);
  const definitions: FunctionDefinitionSource[] = [];
  const re = /([fgh])\s*\(\s*([a-zA-Z])\s*\)\s*=/g;
  const matches = [...text.matchAll(re)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? text.length;
    const body = cutFunctionBody(text.slice(bodyStart, bodyEnd));
    if (!body) continue;
    if (definitions.some((item) => item.name === match[1])) continue;
    definitions.push({ name: match[1], param: match[2], body });
  }
  if (definitions.length === 0) {
    const yMatches = [...text.matchAll(/(?:^|[^a-zA-Z])y\s*=\s*/g)];
    for (let index = 0; index < yMatches.length; index += 1) {
      const match = yMatches[index];
      const bodyStart = (match.index ?? 0) + match[0].length;
      const bodyEnd = yMatches[index + 1]?.index ?? text.length;
      const body = cutFunctionBody(text.slice(bodyStart, bodyEnd));
      if (!body) continue;
      definitions.push({
        name: ['f', 'g', 'h', 'k'][index] ?? `y${index}`,
        param: 'x',
        body,
        displayName: 'y',
      });
    }
  }
  return definitions;
}

function pickTargetName(question: string, definitions: FunctionDefinitionSource[]): string | undefined {
  if (definitions.length === 0) return undefined;
  const explicit = normalizeText(question).match(/(?:画出?|作出?|绘制|研究|求)\s*(?:函数)?\s*([fgh])\s*\(/);
  if (explicit && definitions.some((item) => item.name === explicit[1])) return explicit[1];
  const y = definitions.find((item) => item.displayName === 'y');
  if (y) return y.name;
  return definitions[definitions.length - 1]?.name;
}

function applyParameters(
  node: ExprNode,
  question: string,
): { node: ExprNode; sliders: Record<string, unknown>[] } {
  const names = [...collectVariables(node)].filter((name) => !['x', 'y', 'pi', 'e'].includes(name));
  const values: Record<string, number> = {};
  const sliders: Record<string, unknown>[] = [];
  for (const param of names) {
    const assigned = normalizeText(question).match(new RegExp(`\\b${param}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
    if (assigned) {
      values[param] = Number(assigned[1]);
      continue;
    }
    const bounded = normalizeText(question).match(
      new RegExp(`\\b${param}\\s*(?:∈|属于|在)\\s*\\[\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]`),
    );
    const min = bounded ? Number(bounded[1]) : 0.5;
    const max = bounded ? Number(bounded[2]) : 3;
    sliders.push({ param, min, max, step: 0.1, value: round((min + max) / 2, 2) });
  }
  return { node: substituteVariables(node, values), sliders };
}

function buildFunctionItem(
  definition: FunctionDefinitionSource,
  definitions: Map<string, FunctionDefinition>,
  piecewiseNames: Set<string>,
  question: string,
): ParsedFunction {
  if (definition.body.includes('\\begin{cases}')) {
    const branches = parseCases(definition.body);
    const sliders: Record<string, unknown>[] = [];
    const applied = branches.map((branch) => {
      const whenApplied = applyParameters(parseExpression(branch.when), question);
      const thenApplied = applyParameters(parseExpression(branch.then), question);
      sliders.push(...whenApplied.sliders, ...thenApplied.sliders);
      return {
        when: serializeExpression(whenApplied.node),
        then: serializeExpression(thenApplied.node),
      };
    });
    return {
      name: definition.name,
      param: definition.param,
      expression: '',
      piecewise: applied,
      label: `${definition.displayName ?? definition.name}(${definition.param})=分段函数`,
      sliders,
    };
  }

  const normalized = normalizeExpression(definition.body);
  if (!normalized) throw new Error('函数表达式为空');
  let ast = parseExpression(normalized);
  for (const name of piecewiseNames) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(normalized)) {
      throw new Error(`暂不支持分段函数参与复合：${name}`);
    }
  }
  ast = substituteFunctions(ast, definitions);
  const applied = applyParameters(ast, question);
  const expression = serializeExpression(applied.node);
  return {
    name: definition.name,
    param: definition.param,
    expression,
    label: (definition.displayName ?? definition.name) === 'y' ? `y=${expression.replace(/\*/g, '')}` : `${definition.displayName ?? definition.name}(${definition.param})=${expression.replace(/\*/g, '')}`,
    sliders: applied.sliders,
  };
}

function extractInequality(question: string): { left: string; operator: string; right: string } | null {
  const text = normalizeText(question);
  const match = text.match(/([^,;。]*?x[^,;。]*?)\s*(<=|>=|<|>)\s*([^,;。]+)/);
  if (!match) return null;
  const left = splitExpression(match[1]);
  const right = splitExpression(match[3]);
  if (!left || !hasVariable(left)) return null;
  return { left, operator: match[2], right: right || '0' };
}

function modelFunction(question: string, subject?: string): ModeledVisualization | null {
  const definitions = findFunctionDefinitions(question);
  const inequality = /\\begin\{cases\}/.test(question) ? null : extractInequality(question);
  if (definitions.length === 0 && !inequality) return null;

  const targetName = pickTargetName(question, definitions);
  const ordered = definitions
    .slice()
    .sort((a, b) => (a.name === targetName ? -1 : b.name === targetName ? 1 : 0));
  const synthetic: FunctionDefinitionSource[] = ordered.length
    ? ordered
    : [{ name: 'f', param: 'x', body: inequality!.left }];

  const piecewiseNames = new Set(
    synthetic.filter((item) => item.body.includes('\\begin{cases}')).map((item) => item.name),
  );
  const functionTable = new Map<string, FunctionDefinition>();
  for (const definition of synthetic) {
    if (definition.body.includes('\\begin{cases}')) continue;
    const normalized = normalizeExpression(definition.body);
    if (!normalized) continue;
    functionTable.set(definition.name, {
      name: definition.name,
      params: [definition.param],
      body: parseExpression(normalized),
    });
  }

  const functions = synthetic.map((definition) =>
    buildFunctionItem(definition, functionTable, piecewiseNames, question),
  );
  const primary = functions[0];
  const range = extractInterval(question) ?? (primary.piecewise ? ([-8, 8] as [number, number]) : autoRange(primary.expression));
  const relations: Record<string, unknown>[] = [];
  if (functions.length >= 2 && functions[0].expression && functions[1].expression && /交点|相交|交于/.test(question)) {
    relations.push({ kind: 'intersection', solve: `${functions[0].expression}=${functions[1].expression}` });
  }
  const regions: Record<string, unknown>[] = [];
  if (inequality) {
    regions.push({ where: `${inequality.left}${inequality.operator}${inequality.right}`, fill: 'rgba(64,158,255,0.18)' });
  }
  const sliders = functions.flatMap((item) => item.sliders);
  const uniqueSliders = [...new Map(sliders.map((item) => [item.param, item])).values()];
  const spec: Record<string, unknown> = {
    functions: functions.map(({ sliders: _sliders, ...item }) => item),
    range,
    relations,
    regions,
    sliders: uniqueSliders,
  };
  if (functions.length === 1 && primary.expression) spec.expression = primary.expression;
  const titleParts = functions.map((item) => item.label).join('，');
  void subject;
  return {
    type: 'function2d',
    title: clampText(`函数 ${titleParts}`),
    spec,
    basis: `解析到 ${functions.length} 个函数表达式${inequality ? '与不等式' : ''}`,
  };
}
function modelConic(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  if (!/椭圆|双曲线|抛物线|圆锥曲线/.test(text)) return null;
  const equations = [...text.matchAll(/([a-zA-Z0-9^+\-*/(). ]+)\s*=\s*([a-zA-Z0-9^+\-*/(). ]+)/g)]
    .map((match) => ({
      left: normalizeExpression(match[1]),
      right: normalizeExpression(match[2]),
      raw: `${match[1].trim()}=${match[2].trim()}`,
    }))
    .filter((item) => item.left && item.right && /x/.test(item.left + item.right) && /y/.test(item.left + item.right));
  if (equations.length === 0) return null;
  const equation = equations[0];
  const expression = equation.right === '0' ? equation.left : `(${equation.left})-(${equation.right})`;
  const denominators = [...expression.matchAll(/\/\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const extent = denominators.length ? Math.max(...denominators) + 2 : 8;
  return {
    type: 'conic',
    title: clampText(`圆锥曲线 ${equation.raw}`),
    spec: {
      expression,
      functions: [{ expression, label: equation.raw, color: '#409eff' }],
      implicit: true,
      range: [-extent, extent],
    },
    basis: `解析到方程 ${equation.raw}`,
  };
}

// ---------------------------------------------------------------------------
// 立体几何
// ---------------------------------------------------------------------------

interface PointMap {
  points: { id: string; coord: [number, number, number] }[];
  ids: Set<string>;
}

function addPoint(map: PointMap, id: string, coord: [number, number, number]): void {
  if (!id || map.ids.has(id)) return;
  map.ids.add(id);
  map.points.push({ id, coord: coord.map((value) => round(value)) as [number, number, number] });
}

function pointOf(map: PointMap, id: string): [number, number, number] | null {
  const point = map.points.find((item) => item.id === id);
  return point ? point.coord : null;
}

function parseMidpoints(text: string, map: PointMap): void {
  const re = /([A-Z](?:\d)?)\s*(?:为|是|取)\s*(?:棱)?\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)\s*(?:的)?中点/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const a = pointOf(map, match[2]);
    const b = pointOf(map, match[3]);
    if (a && b) addPoint(map, match[1], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  }
}

function parseRatioPoints(text: string, map: PointMap): void {
  const re = /([A-Z](?:\d)?)\s*(?:在|为)\s*(?:棱)?\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)\s*上[^。;]*?([A-Z](?:\d)?)\s*:\s*([A-Z](?:\d)?)\s*=\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const a = pointOf(map, match[2]);
    const b = pointOf(map, match[3]);
    const p = match[4];
    const q = match[5];
    const n1 = Number(match[6]);
    const n2 = Number(match[7]);
    if (!a || !b || !Number.isFinite(n1) || !Number.isFinite(n2) || n1 + n2 === 0) continue;
    const start = p === match[2] || p === q ? a : b;
    const end = p === match[2] || p === q ? b : a;
    const t = n1 / (n1 + n2);
    addPoint(map, match[1], [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
      start[2] + (end[2] - start[2]) * t,
    ]);
  }
}

function collectLinePairs(text: string, map: PointMap): [string, string][] {
  const pairs: [string, string][] = [];
  const add = (a: string, b: string) => {
    if (a !== b && pointOf(map, a) && pointOf(map, b)) pairs.push([a, b]);
  };
  for (const match of text.matchAll(/体对角线\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)/g)) add(match[1], match[2]);
  for (const match of text.matchAll(/(?:直线|线段|连接|连)\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)/g)) add(match[1], match[2]);
  return pairs;
}

function parseSectionPoints(text: string): string[] {
  const matches = [
    ...text.matchAll(/(?:过|经过)\s*([A-Z](?:\d)?(?:\s*[、,和与]\s*[A-Z](?:\d)?){2,})\s*(?:三点|的截面|的平面|截面)?/g),
    ...text.matchAll(/截面\s*([A-Z](?:\d)?(?:\s*[、,和与]?\s*[A-Z](?:\d)?){2,})/g),
  ];
  for (const match of matches) {
    const ids = match[1].match(/[A-Z](?:\d)?/g) ?? [];
    const unique = [...new Set(ids)];
    if (unique.length >= 3) return unique;
  }
  return [];
}

function cubeSpec(question: string): ModeledVisualization | null {
  if (!/正方体|立方体|长方体|棱长/.test(question)) return null;
  const text = normalizeText(question);
  const sideMatch = text.match(/(?:棱长|边长)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const side = sideMatch ? Number(sideMatch[1]) : 1;
  const topMatch = text.match(/ABCD\s*-\s*([A-Z])([A-Z])([A-Z])([A-Z])/);
  const topIds = topMatch ? [topMatch[1], topMatch[2], topMatch[3], topMatch[4]] : ['A1', 'B1', 'C1', 'D1'];
  const bottomIds = ['A', 'B', 'C', 'D'];
  const map: PointMap = { points: [], ids: new Set() };
  const coords: [number, number, number][] = [
    [0, 0, 0],
    [side, 0, 0],
    [side, side, 0],
    [0, side, 0],
  ];
  bottomIds.forEach((id, index) => addPoint(map, id, coords[index]));
  topIds.forEach((id, index) => addPoint(map, id, [coords[index][0], coords[index][1], side]));
  parseMidpoints(text, map);
  parseRatioPoints(text, map);

  const edges: [string, string][] = [];
  const link = (a: string, b: string) => {
    if (pointOf(map, a) && pointOf(map, b)) edges.push([a, b]);
  };
  for (let i = 0; i < 4; i += 1) {
    link(bottomIds[i], bottomIds[(i + 1) % 4]);
    link(topIds[i], topIds[(i + 1) % 4]);
    link(bottomIds[i], topIds[i]);
  }
  const faces = [
    bottomIds,
    [...topIds].reverse(),
    [bottomIds[0], bottomIds[1], topIds[1], topIds[0]],
    [bottomIds[1], bottomIds[2], topIds[2], topIds[1]],
    [bottomIds[2], bottomIds[3], topIds[3], topIds[2]],
    [bottomIds[3], bottomIds[0], topIds[0], topIds[3]],
  ];
  const auxiliary: Record<string, unknown>[] = [];
  const section = parseSectionPoints(text).filter((id) => pointOf(map, id));
  if (section.length >= 3) {
    auxiliary.push({
      kind: 'plane',
      points: section,
      style: { color: '#f56c6c', opacity: 0.35 },
      reason: `过 ${section.join('、')} 的截面`,
    });
  }
  for (const [a, b] of collectLinePairs(text, map)) {
    auxiliary.push({ kind: 'line', points: [a, b], style: { color: '#e6a23c' }, reason: `线段 ${a}${b}` });
  }
  return {
    type: 'geometry3d',
    title: clampText(`正方体 ${bottomIds.join('')}-${topIds.join('')}（棱长 ${side}）`),
    spec: { points: map.points, edges, faces, auxiliary, labels: true },
    basis: `解析到正方体棱长 ${side}，${map.points.length} 个点`,
  };
}

function pyramidSpec(question: string): ModeledVisualization | null {
  if (!/棱锥/.test(question)) return null;
  const text = normalizeText(question);
  const match = text.match(/([A-Z])\s*-\s*([A-Z]{3,4})/);
  if (!match) return null;
  const apex = match[1];
  const baseIds = match[2].split('');
  if (baseIds.length < 3 || baseIds.length > 4) return null;
  const sideMatch = text.match(/(?:底面边长|边长|棱长)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const heightMatch = text.match(/高(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const side = sideMatch ? Number(sideMatch[1]) : 2;
  const height = heightMatch ? Number(heightMatch[1]) : side;
  const map: PointMap = { points: [], ids: new Set() };
  if (baseIds.length === 4) {
    const half = side / 2;
    addPoint(map, baseIds[0], [-half, -half, 0]);
    addPoint(map, baseIds[1], [half, -half, 0]);
    addPoint(map, baseIds[2], [half, half, 0]);
    addPoint(map, baseIds[3], [-half, half, 0]);
  } else {
    const radius = side / Math.sqrt(3);
    for (let index = 0; index < 3; index += 1) {
      const angle = Math.PI / 2 + (index * 2 * Math.PI) / 3;
      addPoint(map, baseIds[index], [round(radius * Math.cos(angle)), round(radius * Math.sin(angle)), 0]);
    }
  }
  addPoint(map, apex, [0, 0, height]);
  addPoint(map, 'O', [0, 0, 0]);
  parseMidpoints(text, map);
  parseRatioPoints(text, map);
  const edges: [string, string][] = [];
  for (let index = 0; index < baseIds.length; index += 1) {
    edges.push([baseIds[index], baseIds[(index + 1) % baseIds.length]]);
    edges.push([apex, baseIds[index]]);
  }
  const faces = [
    baseIds,
    ...baseIds.map((id, index) => [apex, id, baseIds[(index + 1) % baseIds.length]]),
  ];
  const auxiliary: Record<string, unknown>[] = [];
  if (/高|体积|线面角|二面角/.test(text)) {
    auxiliary.push({ kind: 'perpendicular', points: [apex, 'O'], style: { dash: true, color: '#e6a23c' }, reason: `${apex}O 为棱锥的高` });
  }
  return {
    type: 'geometry3d',
    title: clampText(`棱锥 ${apex}-${baseIds.join('')}（底边 ${side}，高 ${height}）`),
    spec: { points: map.points, edges, faces, auxiliary, labels: true },
    basis: `解析到棱锥 ${apex}-${baseIds.join('')}，底边 ${side}，高 ${height}`,
  };
}

function roundBodySpec(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  const isCylinder = /圆柱/.test(text);
  const isCone = /圆锥/.test(text);
  const isSphere = /球/.test(text) && !/球体运动|球赛/.test(text);
  if (!isCylinder && !isCone && !isSphere) return null;
  const rMatch = text.match(/(?:半径|底面半径)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const hMatch = text.match(/高(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const r = rMatch ? Number(rMatch[1]) : 1;
  const h = hMatch ? Number(hMatch[1]) : r * 2;
  const map: PointMap = { points: [], ids: new Set() };
  const ring = (prefix: string, plane: 'xy' | 'xz' | 'yz', radius: number, offset = 0) => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index * Math.PI * 2) / 12;
      const id = `${prefix}${index}`;
      const coord: [number, number, number] =
        plane === 'xy'
          ? [round(radius * Math.cos(angle)), round(radius * Math.sin(angle)), offset]
          : plane === 'xz'
            ? [round(radius * Math.cos(angle)), offset, round(radius * Math.sin(angle))]
            : [offset, round(radius * Math.cos(angle)), round(radius * Math.sin(angle))];
      addPoint(map, id, coord);
      ids.push(id);
    }
    return ids;
  };
  const edges: [string, string][] = [];
  if (isSphere) {
    const rings = [ring('a', 'xy', r), ring('b', 'xz', r), ring('c', 'yz', r)];
    for (const ids of rings) {
      for (let index = 0; index < ids.length; index += 1) edges.push([ids[index], ids[(index + 1) % ids.length]]);
    }
    return {
      type: 'geometry3d',
      title: clampText(`球（半径 ${r}）`),
      spec: { points: map.points, edges, faces: [], auxiliary: [], labels: false },
      basis: `解析到球半径 ${r}`,
    };
  }
  if (isCylinder) {
    const bottom = ring('b', 'xy', r, 0);
    const top = ring('t', 'xy', r, h);
    for (let index = 0; index < 12; index += 1) {
      edges.push([bottom[index], bottom[(index + 1) % 12]]);
      edges.push([top[index], top[(index + 1) % 12]]);
      edges.push([bottom[index], top[index]]);
    }
    return {
      type: 'geometry3d',
      title: clampText(`圆柱（半径 ${r}，高 ${h}）`),
      spec: { points: map.points, edges, faces: [], auxiliary: [], labels: false },
      basis: `解析到圆柱半径 ${r}、高 ${h}`,
    };
  }
  const bottom = ring('b', 'xy', r, 0);
  addPoint(map, 'P', [0, 0, h]);
  for (let index = 0; index < 12; index += 1) {
    edges.push([bottom[index], bottom[(index + 1) % 12]]);
    edges.push([bottom[index], 'P']);
  }
  const faces = bottom.map((id, index) => ['P', id, bottom[(index + 1) % 12]]);
  return {
    type: 'geometry3d',
    title: clampText(`圆锥（半径 ${r}，高 ${h}）`),
    spec: { points: map.points, edges, faces, auxiliary: [], labels: false },
    basis: `解析到圆锥半径 ${r}、高 ${h}`,
  };
}

function modelGeometry(question: string): ModeledVisualization | null {
  return cubeSpec(question) ?? pyramidSpec(question) ?? roundBodySpec(question);
}

// ---------------------------------------------------------------------------
// 化学分子
// ---------------------------------------------------------------------------

interface MoleculeData {
  formula: string;
  name: string;
  angle?: string;
  atoms: { symbol: string; x: number; y: number; z: number }[];
}

const MOLECULES: MoleculeData[] = [
  {
    formula: 'H2O',
    name: '水',
    angle: '104.5°',
    atoms: [
      { symbol: 'O', x: 0, y: 0, z: 0 },
      { symbol: 'H', x: 0.757, y: 0.586, z: 0 },
      { symbol: 'H', x: -0.757, y: 0.586, z: 0 },
    ],
  },
  {
    formula: 'CH4',
    name: '甲烷',
    angle: '109.5°',
    atoms: [
      { symbol: 'C', x: 0, y: 0, z: 0 },
      { symbol: 'H', x: 0.629, y: 0.629, z: 0.629 },
      { symbol: 'H', x: -0.629, y: -0.629, z: 0.629 },
      { symbol: 'H', x: -0.629, y: 0.629, z: -0.629 },
      { symbol: 'H', x: 0.629, y: -0.629, z: -0.629 },
    ],
  },
  {
    formula: 'NH3',
    name: '氨',
    angle: '107°',
    atoms: [
      { symbol: 'N', x: 0, y: 0, z: 0.12 },
      { symbol: 'H', x: 0.94, y: 0, z: -0.28 },
      { symbol: 'H', x: -0.47, y: 0.814, z: -0.28 },
      { symbol: 'H', x: -0.47, y: -0.814, z: -0.28 },
    ],
  },
  {
    formula: 'CO2',
    name: '二氧化碳',
    angle: '180°',
    atoms: [
      { symbol: 'O', x: -1.16, y: 0, z: 0 },
      { symbol: 'C', x: 0, y: 0, z: 0 },
      { symbol: 'O', x: 1.16, y: 0, z: 0 },
    ],
  },
  {
    formula: 'C2H4',
    name: '乙烯',
    angle: '120°',
    atoms: [
      { symbol: 'C', x: -0.67, y: 0, z: 0 },
      { symbol: 'C', x: 0.67, y: 0, z: 0 },
      { symbol: 'H', x: -1.24, y: 0.93, z: 0 },
      { symbol: 'H', x: -1.24, y: -0.93, z: 0 },
      { symbol: 'H', x: 1.24, y: 0.93, z: 0 },
      { symbol: 'H', x: 1.24, y: -0.93, z: 0 },
    ],
  },
  {
    formula: 'C2H2',
    name: '乙炔',
    angle: '180°',
    atoms: [
      { symbol: 'C', x: -0.6, y: 0, z: 0 },
      { symbol: 'C', x: 0.6, y: 0, z: 0 },
      { symbol: 'H', x: -1.66, y: 0, z: 0 },
      { symbol: 'H', x: 1.66, y: 0, z: 0 },
    ],
  },
  {
    formula: 'C6H6',
    name: '苯',
    angle: '120°',
    atoms: Array.from({ length: 6 }, (_, index) => {
      const angle = (index * Math.PI) / 3;
      return { symbol: 'C', x: round(1.4 * Math.cos(angle)), y: round(1.4 * Math.sin(angle)), z: 0 };
    }).concat(
      Array.from({ length: 6 }, (_, index) => {
        const angle = (index * Math.PI) / 3;
        return { symbol: 'H', x: round(2.5 * Math.cos(angle)), y: round(2.5 * Math.sin(angle)), z: 0 };
      }),
    ),
  },
  {
    formula: 'SO2',
    name: '二氧化硫',
    angle: '119°',
    atoms: [
      { symbol: 'S', x: 0, y: 0, z: 0 },
      { symbol: 'O', x: -1.2, y: 0.7, z: 0 },
      { symbol: 'O', x: 1.2, y: 0.7, z: 0 },
    ],
  },
  {
    formula: 'BF3',
    name: '三氟化硼',
    angle: '120°',
    atoms: [
      { symbol: 'B', x: 0, y: 0, z: 0 },
      { symbol: 'F', x: 1.3, y: 0, z: 0 },
      { symbol: 'F', x: -0.65, y: 1.126, z: 0 },
      { symbol: 'F', x: -0.65, y: -1.126, z: 0 },
    ],
  },
  {
    formula: 'PCl5',
    name: '五氯化磷',
    angle: '90°/120°',
    atoms: [
      { symbol: 'P', x: 0, y: 0, z: 0 },
      { symbol: 'Cl', x: 0, y: 0, z: 1.9 },
      { symbol: 'Cl', x: 0, y: 0, z: -1.9 },
      { symbol: 'Cl', x: 1.9, y: 0, z: 0 },
      { symbol: 'Cl', x: -0.95, y: 1.645, z: 0 },
      { symbol: 'Cl', x: -0.95, y: -1.645, z: 0 },
    ],
  },
  {
    formula: 'HCl',
    name: '氯化氢',
    atoms: [
      { symbol: 'H', x: -0.64, y: 0, z: 0 },
      { symbol: 'Cl', x: 0.64, y: 0, z: 0 },
    ],
  },
  {
    formula: 'O2',
    name: '氧气',
    atoms: [
      { symbol: 'O', x: -0.6, y: 0, z: 0 },
      { symbol: 'O', x: 0.6, y: 0, z: 0 },
    ],
  },
  {
    formula: 'N2',
    name: '氮气',
    atoms: [
      { symbol: 'N', x: -0.55, y: 0, z: 0 },
      { symbol: 'N', x: 0.55, y: 0, z: 0 },
    ],
  },
];

function xyzData(molecule: MoleculeData): string {
  const lines = [`${molecule.atoms.length}`, molecule.name];
  for (const atom of molecule.atoms) lines.push(`${atom.symbol} ${atom.x} ${atom.y} ${atom.z}`);
  return `${lines.join('\n')}\n`;
}

function modelMolecule(question: string): ModeledVisualization | null {
  const text = normalizeText(question).toLowerCase();
  const formulaMatch = normalizeText(question).match(/\b([A-Z][a-z]?\d*){2,}\b/);
  const formula = formulaMatch?.[0]?.replace(/[^A-Za-z0-9]/g, '') ?? '';
  const molecule = MOLECULES.find(
    (item) =>
      text.includes(item.formula.toLowerCase()) ||
      text.includes(item.name) ||
      (formula && formula.toLowerCase() === item.formula.toLowerCase()),
  );
  if (!molecule) {
    if (/氯化钠|nacl|晶体/.test(text)) return modelCrystal(question);
    return null;
  }
  return {
    type: 'molecule',
    title: clampText(`${molecule.name} ${molecule.formula}${molecule.angle ? `（键角 ${molecule.angle}）` : ''}`),
    spec: { format: 'xyz', style: 'stick', data: xyzData(molecule) },
    basis: `识别到分子 ${molecule.formula}`,
  };
}

function modelCrystal(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  if (!/氯化钠|nacl|晶体/.test(text)) return null;
  const points: { id: string; coord: [number, number, number] }[] = [];
  const edges: [string, string][] = [];
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let z = 0; z < 3; z += 1) {
        points.push({ id: `${x}${y}${z}`, coord: [x, y, z] });
      }
    }
  }
  for (const point of points) {
    const [x, y, z] = point.coord;
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]) {
      const target = `${x + dx}${y + dy}${z + dz}`;
      if (points.some((item) => item.id === target)) edges.push([point.id, target]);
    }
  }
  return {
    type: 'geometry3d',
    title: '氯化钠晶体结构',
    spec: { points, edges, faces: [], auxiliary: [], labels: false },
    basis: '识别到氯化钠晶体',
  };
}

// ---------------------------------------------------------------------------
// 物理图示
// ---------------------------------------------------------------------------

function modelPaperFeed(question: string): ModeledVisualization | null {
  if (!/打印机|进纸|搓纸|滚轮|摩擦片/.test(question)) return null;
  const text = normalizeText(question);
  const sheetMatch = [...text.matchAll(/第\s*(\d+)\s*张/g)].map((match) => Number(match[1]));
  const referenced = sheetMatch.length ? Math.max(...sheetMatch) : 0;
  const count = Math.min(6, Math.max(4, referenced));
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [80, 370], to: [640, 370] },
    { kind: 'text', x: 520, y: 392, text: '送纸方向 →' },
    { kind: 'circle', x: 360, y: 76, r: 28, label: '滚轮' },
    { kind: 'arrow', from: [360, 14], to: [360, 40], label: 'F压', color: '#e6a23c' },
  ];
  const top = 150;
  const gap = 24;
  for (let index = 0; index < count; index += 1) {
    const y = top + index * gap;
    elements.push({ kind: 'rect', x: 250, y, w: 340, h: 12 });
    elements.push({ kind: 'text', x: 180, y: y + 11, text: `第${index + 1}张` });
  }
  const bottom = top + count * gap;
  elements.push({ kind: 'rect', x: 250, y: bottom, w: 340, h: 12 });
  elements.push({ kind: 'text', x: 390, y: bottom + 34, text: '摩擦片' });
  elements.push({ kind: 'arrow', from: [570, top + 6], to: [650, top + 6], label: 'f滚轮', color: '#2f5bea' });
  elements.push({ kind: 'arrow', from: [570, top + gap * 2 + 6], to: [650, top + gap * 2 + 6], label: '层间摩擦', color: '#67c23a' });
  elements.push({ kind: 'arrow', from: [250, bottom + 34], to: [160, bottom + 34], label: 'f', color: '#f56c6c' });
  elements.push({ kind: 'text', x: 100, y: 340, text: '滚轮带动第1张，纸间摩擦逐层传递，摩擦片拦住整叠' });
  return {
    type: 'physics',
    title: '打印机进纸：层间摩擦力',
    spec: { elements },
    basis: `识别到打印机进纸模型，${count} 张纸`,
  };
}

function modelIncline(question: string): ModeledVisualization | null {
  if (!/斜面|倾角|斜坡|传送带/.test(question)) return null;
  const text = normalizeText(question);
  const angleMatch = text.match(/(?:倾角|角度)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? text.match(/(\d+(?:\.\d+)?)\s*°/);
  const angle = angleMatch ? Number(angleMatch[1]) : 30;
  const massMatch = text.match(/(?:质量|物重)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:kg|千克)?/);
  const muMatch = text.match(/(?:摩擦因数|摩擦系数|μ)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const mass = massMatch ? Number(massMatch[1]) : null;
  const mu = muMatch ? Number(muMatch[1]) : null;
  const rad = (angle * Math.PI) / 180;
  const start = [80, 340];
  const length = 500;
  const end = [round(start[0] + length * Math.cos(rad)), round(start[1] - length * Math.sin(rad))];
  const t = 0.58;
  const cx = round(start[0] + (end[0] - start[0]) * t);
  const cy = round(start[1] + (end[1] - start[1]) * t);
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [40, 340], to: [660, 340], label: '地面' },
    { kind: 'line', from: start as [number, number], to: end as [number, number], label: `斜面 ${angle}°` },
    { kind: 'rect', x: cx - 35, y: cy - 45, w: 70, h: 44, label: mass ? `m=${mass}kg` : 'm', rotate: -angle },
    { kind: 'arrow', from: [cx, cy], to: [cx, cy + 90], label: mass ? `G=${round(mass * 9.8, 1)}N` : 'G', color: '#f56c6c' },
    { kind: 'arrow', from: [cx, cy], to: [round(cx - 60 * Math.sin(rad)), round(cy - 60 * Math.cos(rad))], label: 'N', color: '#409eff' },
    { kind: 'arrow', from: [cx, cy], to: [round(cx + 70 * Math.cos(rad)), round(cy - 70 * Math.sin(rad))], label: mu !== null ? `f（μ=${mu}）` : 'f', color: '#67c23a' },
    { kind: 'text', x: 420, y: 380, text: mu !== null ? `沿斜面分解重力，f = μN` : '沿斜面与垂直斜面分解重力' },
  ];
  return {
    type: 'physics',
    title: clampText(`斜面受力分析（倾角 ${angle}°${mass ? `，m=${mass}kg` : ''}）`),
    spec: { elements },
    basis: `解析到斜面倾角 ${angle}°${mass ? `、质量 ${mass}kg` : ''}${mu !== null ? `、摩擦因数 ${mu}` : ''}`,
  };
}

function modelCircuit(question: string): ModeledVisualization | null {
  if (!/电路|电阻|欧姆|电流|电压|串联|并联/.test(question)) return null;
  const text = normalizeText(question);
  const resistors = [...text.matchAll(/R\s*(\d+)?\s*=\s*(\d+(?:\.\d+)?)\s*(?:Ω|欧)?/gi)].map((match) => ({
    name: `R${match[1] ?? ''}`,
    value: Number(match[2]),
  }));
  const voltageMatch = text.match(/(?:U|电压)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:V|伏)?/);
  const voltage = voltageMatch ? Number(voltageMatch[1]) : null;
  const parallel = /并联/.test(text);
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [120, 100], to: [560, 100] },
    { kind: 'line', from: [560, 100], to: [560, 310] },
    { kind: 'line', from: [560, 310], to: [120, 310] },
    { kind: 'line', from: [120, 310], to: [120, 100] },
    { kind: 'circle', x: 120, y: 205, r: 24, label: voltage !== null ? `U=${voltage}V` : 'U' },
  ];
  if (parallel) {
    elements.push(
      { kind: 'line', from: [300, 100], to: [300, 170] },
      { kind: 'line', from: [300, 240], to: [300, 310] },
      { kind: 'line', from: [300, 170], to: [450, 170] },
      { kind: 'line', from: [450, 170], to: [450, 240] },
      { kind: 'line', from: [300, 240], to: [450, 240] },
      { kind: 'rect', x: 330, y: 154, w: 90, h: 32, label: resistors[0] ? `${resistors[0].name}=${resistors[0].value}Ω` : 'R1' },
      { kind: 'rect', x: 330, y: 224, w: 90, h: 32, label: resistors[1] ? `${resistors[1].name}=${resistors[1].value}Ω` : 'R2' },
    );
  } else {
    elements.push(
      { kind: 'rect', x: 220, y: 84, w: 90, h: 32, label: resistors[0] ? `${resistors[0].name}=${resistors[0].value}Ω` : 'R1' },
      { kind: 'rect', x: 390, y: 84, w: 90, h: 32, label: resistors[1] ? `${resistors[1].name}=${resistors[1].value}Ω` : 'R2' },
      { kind: 'arrow', from: [200, 100], to: [250, 100], label: 'I', color: '#e6a23c' },
    );
  }
  const values = resistors.map((item) => item.value).filter((value) => Number.isFinite(value));
  let currentText = 'I = U / R';
  if (voltage !== null && values.length > 0) {
    const equivalent = parallel
      ? 1 / values.reduce((sum, value) => sum + 1 / value, 0)
      : values.reduce((sum, value) => sum + value, 0);
    if (Number.isFinite(equivalent) && equivalent !== 0) {
      currentText = `I = ${voltage} / ${round(equivalent, 2)} = ${round(voltage / equivalent, 3)} A`;
    }
  }
  elements.push({ kind: 'text', x: 250, y: 350, text: currentText });
  return {
    type: 'physics',
    title: clampText(`${parallel ? '并联' : '串联'}电路${voltage !== null ? `（U=${voltage}V）` : ''}`),
    spec: { elements },
    basis: `解析到${parallel ? '并联' : '串联'}电路${resistors.length ? `，${resistors.length} 个电阻` : ''}`,
  };
}

function modelLens(question: string): ModeledVisualization | null {
  if (!/透镜|焦距|物距|成像|光路/.test(question)) return null;
  const text = normalizeText(question);
  const fMatch = text.match(/焦距(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const uMatch = text.match(/物距(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  if (!fMatch || !uMatch) return null;
  const f = Number(fMatch[1]);
  const u = Number(uMatch[1]);
  if (!(f > 0) || !(u > 0)) return null;
  const concave = /凹透镜/.test(text);
  const focal = concave ? -f : f;
  const v = 1 / (1 / focal - 1 / u);
  const scale = 260 / Math.max(u, Math.abs(v) || u);
  const center = 360;
  const objectX = center - u * scale;
  const imageX = center + v * scale;
  const objectHeight = 46;
  const imageHeight = Number.isFinite(v) ? (-objectHeight * v) / u : 0;
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [60, 210], to: [660, 210], label: '主光轴' },
    { kind: 'line', from: [center, 80], to: [center, 340], label: '透镜' },
    { kind: 'arrow', from: [objectX, 210], to: [objectX, 210 - objectHeight], label: '物', color: '#2f5bea' },
    { kind: 'arrow', from: [imageX, 210], to: [imageX, 210 - imageHeight], label: '像', color: '#f56c6c' },
    { kind: 'line', from: [objectX, 210 - objectHeight], to: [center, 210], label: '' },
    { kind: 'line', from: [center, 210], to: [imageX, 210 - imageHeight], label: '' },
    { kind: 'text', x: 80, y: 380, text: `f=${f} ${concave ? '（凹透镜）' : ''}，u=${u}，v=${round(v, 2)}` },
  ];
  return {
    type: 'diagram',
    title: clampText(`${concave ? '凹' : '凸'}透镜成像（f=${f}，u=${u}）`),
    spec: { elements },
    basis: `解析到焦距 ${f}、物距 ${u}`,
  };
}

function modelPlaneGeometry(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  if (!/正方形|矩形|长方形|三角形|直角三角形|等边三角形|平行四边形|梯形|圆/.test(text)) return null;

  const elements: Record<string, unknown>[] = [];
  const numberAfter = (pattern: RegExp): number | null => {
    const match = text.match(pattern);
    return match ? Number(match[1]) : null;
  };

  if (/圆/.test(text) && !/三角形|正方形|矩形|梯形|平行四边形/.test(text)) {
    const radiusValue = numberAfter(/(?:半径)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
    const diameterValue = numberAfter(/(?:直径)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
    const radius = radiusValue ?? (diameterValue ? diameterValue / 2 : 2);
    const r = Math.min(140, Math.max(30, radius * 28));
    elements.push(
      { kind: 'circle', x: 360, y: 205, r, label: 'O' },
      { kind: 'line', from: [360, 205], to: [360 + r, 205] },
      { kind: 'text', x: 360 + r / 2, y: 198, text: `r=${round(radius, 3)}` },
      { kind: 'text', x: 320, y: 300, text: `圆：半径 ${round(radius, 3)}` },
    );
    return {
      type: 'diagram',
      title: clampText(`圆（半径 ${round(radius, 3)}）`),
      spec: { elements },
      basis: `解析到圆半径 ${round(radius, 3)}`,
    };
  }

  if (/正方形|矩形|长方形/.test(text)) {
    const side = numberAfter(/(?:边长|长|宽)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? 3;
    const width = numberAfter(/长(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? side;
    const height = numberAfter(/宽(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? side;
    const w = Math.min(420, Math.max(80, width * 48));
    const h = Math.min(240, Math.max(60, height * 48));
    const x = 360 - w / 2;
    const y = 210 - h / 2;
    elements.push(
      { kind: 'rect', x, y, w, h, label: /正方形/.test(text) ? '正方形' : '矩形' },
      { kind: 'text', x: x + w / 2, y: y + h + 26, text: `长 ${width}` },
      { kind: 'text', x: x - 34, y: y + h / 2, text: `宽 ${height}` },
    );
    return {
      type: 'diagram',
      title: clampText(
        /正方形/.test(text) ? `正方形（边长 ${width}）` : `矩形（长 ${width}，宽 ${height}）`,
      ),
      spec: { elements },
      basis: /正方形/.test(text) ? `解析到正方形边长 ${width}` : `解析到矩形长 ${width}、宽 ${height}`,
    };
  }

  if (/三角形/.test(text)) {
    const right = /直角三角形/.test(text);
    const legPair = text.match(/直角边[^0-9]*(\d+(?:\.\d+)?)[^0-9]*(\d+(?:\.\d+)?)/);
    const legA = legPair ? Number(legPair[1]) : 3;
    const legB = legPair ? Number(legPair[2]) : 4;
    const generalSide = numberAfter(/(?:边长|三边)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? 3;
    const scale = 46;
    const vertices: { id: string; x: number; y: number }[] = right
      ? [
          { id: 'A', x: 140, y: 320 },
          { id: 'B', x: 140 + legA * scale, y: 320 },
          { id: 'C', x: 140, y: 320 - legB * scale },
        ]
      : [
          { id: 'A', x: 140, y: 320 },
          { id: 'B', x: 140 + generalSide * scale, y: 320 },
          { id: 'C', x: 140 + (generalSide * scale) / 2, y: 320 - generalSide * scale * 0.866 },
        ];
    const [a, b, c] = vertices;
    elements.push(
      { kind: 'line', from: [a.x, a.y], to: [b.x, b.y] },
      { kind: 'line', from: [b.x, b.y], to: [c.x, c.y] },
      { kind: 'line', from: [c.x, c.y], to: [a.x, a.y] },
      { kind: 'text', x: a.x - 20, y: a.y + 18, text: a.id },
      { kind: 'text', x: b.x + 8, y: b.y + 18, text: b.id },
      { kind: 'text', x: c.x - 10, y: c.y - 12, text: c.id },
    );
    if (right) {
      elements.push(
        { kind: 'text', x: a.x + 10, y: a.y - 8, text: '90°' },
        { kind: 'text', x: (a.x + b.x) / 2, y: a.y + 20, text: `${legA}` },
        { kind: 'text', x: a.x - 18, y: (a.y + c.y) / 2, text: `${legB}` },
        { kind: 'text', x: (b.x + c.x) / 2 + 6, y: (b.y + c.y) / 2, text: `斜边 ${round(Math.hypot(legA, legB), 3)}` },
      );
    } else {
      elements.push({ kind: 'text', x: (a.x + b.x) / 2, y: a.y + 22, text: `边长 ${generalSide}` });
    }
    return {
      type: 'diagram',
      title: clampText(right ? `直角三角形（直角边 ${legA}、${legB}）` : `三角形（边长 ${generalSide}）`),
      spec: { elements },
      basis: right ? `解析到直角三角形两直角边 ${legA}、${legB}` : `解析到三角形边长 ${generalSide}`,
    };
  }

  return null;
}

function modelHorizontalForces(question: string): ModeledVisualization | null {
  if (!/受力分析|摩擦力|水平面|水平地面/.test(question)) return null;
  if (!/物体|物块|滑块|木块/.test(question)) return null;
  const text = normalizeText(question);
  const massMatch = text.match(/(?:质量|物重)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:kg|千克)?/);
  const forceMatch = text.match(/(?:拉力|推力|F)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:N|牛)?/);
  const mass = massMatch ? Number(massMatch[1]) : null;
  const force = forceMatch ? Number(forceMatch[1]) : null;
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [80, 300], to: [640, 300], label: '水平面' },
    { kind: 'rect', x: 310, y: 240, w: 110, h: 60, label: mass ? `m=${mass}kg` : 'm' },
    { kind: 'arrow', from: [365, 270], to: [365, 350], label: mass ? `G=${round(mass * 9.8, 1)}N` : 'G', color: '#f56c6c' },
    { kind: 'arrow', from: [365, 270], to: [365, 180], label: 'N', color: '#409eff' },
    { kind: 'arrow', from: [420, 270], to: [520, 270], label: force ? `F=${force}N` : 'F', color: '#67c23a' },
    { kind: 'arrow', from: [310, 270], to: [210, 270], label: 'f', color: '#e6a23c' },
  ];
  return {
    type: 'physics',
    title: clampText(`水平面上物体的受力分析${mass ? `（m=${mass}kg）` : ''}`),
    spec: { elements },
    basis: `解析到水平面受力${mass ? `，质量 ${mass}kg` : ''}`,
  };
}

// ---------------------------------------------------------------------------
// 生物与地理
// ---------------------------------------------------------------------------

function modelBiology(question: string): ModeledVisualization | null {
  if (!/细胞|细胞器|线粒体|叶绿体|细胞核|细胞膜/.test(question)) return null;
  const text = normalizeText(question);
  const plant = /植物细胞|叶绿体|细胞壁|液泡/.test(text);
  const organelles: { id: string; label: string; coord: [number, number, number]; radius: number; color: string }[] = [
    { id: 'membrane', label: plant ? '细胞壁 / 细胞膜' : '细胞膜', coord: [0, 0, 0], radius: 1.7, color: '#8ec5ff' },
    { id: 'nucleus', label: '细胞核', coord: [0.25, 0.1, 0], radius: 0.55, color: '#b07ce8' },
  ];
  const add = (id: string, label: string, coord: [number, number, number], radius: number, color: string) => {
    if (text.includes(label) || text.includes(label.replace('质网', '内质网'))) organelles.push({ id, label, coord, radius, color });
  };
  if (!/线粒体|核糖体|内质网|高尔基体|溶酶体|叶绿体|液泡/.test(text)) {
    organelles.push(
      { id: 'mito', label: '线粒体', coord: [-0.9, -0.4, 0.3], radius: 0.3, color: '#f2a05e' },
      { id: 'ribosome', label: '核糖体', coord: [0.85, -0.7, -0.2], radius: 0.16, color: '#7fd6a4' },
      { id: 'er', label: '内质网', coord: [-0.4, 0.8, -0.2], radius: 0.32, color: '#7aa7e8' },
      { id: 'golgi', label: '高尔基体', coord: [0.7, 0.8, 0.2], radius: 0.25, color: '#d48ac4' },
    );
  } else {
    add('mito', '线粒体', [-0.9, -0.4, 0.3], 0.3, '#f2a05e');
    add('ribosome', '核糖体', [0.85, -0.7, -0.2], 0.16, '#7fd6a4');
    add('er', '内质网', [-0.4, 0.8, -0.2], 0.32, '#7aa7e8');
    add('golgi', '高尔基体', [0.7, 0.8, 0.2], 0.25, '#d48ac4');
    add('lysosome', '溶酶体', [-1.1, 0.5, 0.2], 0.2, '#e0a24a');
    add('chloroplast', '叶绿体', [-0.2, -0.9, 0.1], 0.28, '#5cb85c');
    add('vacuole', '液泡', [0.4, -0.2, -0.3], 0.45, '#9fd3f0');
  }
  return {
    type: 'biology',
    title: clampText(plant ? '植物细胞结构' : '动物细胞结构'),
    spec: { parts: organelles },
    basis: `识别到${plant ? '植物' : '动物'}细胞，${organelles.length} 个结构`,
  };
}

// ---------------------------------------------------------------------------

export function modelVisualization(question: string, subject?: string): ModeledVisualization | null {
  const text = normalizeText(question);
  const models = [
    () => modelMolecule(text),
    () => modelPaperFeed(text),
    () => modelCircuit(text),
    () => modelIncline(text),
    () => modelLens(text),
    () => modelConic(text),
    () => modelFunction(text, subject),
    () => modelGeometry(text),
    () => modelPlaneGeometry(text),
    () => modelHorizontalForces(text),
    () => modelBiology(text),
  ];
  for (const build of models) {
    try {
      const result = build();
      if (result) return result;
    } catch {
      // 单个建模器失败不影响后续匹配
    }
  }
  return null;
}