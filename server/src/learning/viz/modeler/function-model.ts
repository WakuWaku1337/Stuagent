import {
  collectVariables,
  parseExpression,
  serializeExpression,
  substituteFunctions,
  substituteVariables,
  type ExprNode,
  type FunctionDefinition,
} from '../../../../../shared/expression.ts';
import {
  autoRange,
  clampText,
  cutFunctionBody,
  extractInterval,
  hasVariable,
  normalizeCondition,
  normalizeExpression,
  normalizeText,
  parseCases,
  round,
  splitExpression,
  type ModeledVisualization,
} from './core.ts';

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

function pickTargetName(question: string, definitions: FunctionDefinitionSource[]): string | null {
  if (definitions.length === 0) return null;
  const explicit = normalizeText(question).match(/(?:画出?|作出?|绘制|研究|求)\s*(?:函数)?\s*([fgh])\s*\(/);
  if (explicit && definitions.some((item) => item.name === explicit[1])) return explicit[1];
  const y = definitions.find((item) => item.displayName === 'y');
  if (y) return y.name;
  if (definitions.length === 1) return definitions[0].name;
  if (/交点|相交|交于|比较|[与和]/.test(question)) return definitions[0].name;
  return null;
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
  ast = substituteFunctions(ast, definitions);
  const applied = applyParameters(ast, question);
  if (applied.node.kind === 'piecewise') {
    return {
      name: definition.name,
      param: definition.param,
      expression: '',
      piecewise: applied.node.branches.map((branch) => ({
        when: serializeExpression(branch.when),
        then: serializeExpression(branch.then),
      })),
      label: `${definition.displayName ?? definition.name}(${definition.param})=分段函数`,
      sliders: applied.sliders,
    };
  }
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
  const text = normalizeText(question).replace(/^(?:画出|作出|绘制|解|求)\s*/, '');
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
  if (definitions.length > 1 && targetName === null) return null;
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
    if (definition.body.includes('\\begin{cases}')) {
      try {
        const branches = parseCases(definition.body).map((branch) => ({
          when: parseExpression(branch.when),
          then: parseExpression(branch.then),
        }));
        functionTable.set(definition.name, {
          name: definition.name,
          params: [definition.param],
          body: { kind: 'piecewise', branches },
        });
      } catch {
        // 单个分段定义解析失败时保持原有行为：不进入函数表
      }
      continue;
    }
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

export { modelFunction };
