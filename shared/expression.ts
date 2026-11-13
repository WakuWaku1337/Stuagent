/**
 * 共享表达式内核：服务端建模与前端绘制使用同一套语法与求值规则。
 * 只覆盖项目实际需要的高中函数子集，不追求完整 CAS。
 */

export type ExprNode =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '+' | '-'; arg: ExprNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: ExprNode; right: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] }
  | { kind: 'compare'; op: '<' | '<=' | '>' | '>='; left: ExprNode; right: ExprNode }
  | { kind: 'and'; items: ExprNode[] }
  | { kind: 'piecewise'; branches: { when: ExprNode; then: ExprNode }[]; fallback?: ExprNode };

export interface FunctionDefinition {
  name: string;
  params: string[];
  body: ExprNode;
}

export type ExpressionEvaluator = (x: number, scope?: Record<string, number>) => number;

const BUILTIN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'ln', 'exp', 'floor', 'ceil', 'round',
]);

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'name'; value: string; pos: number }
  | { type: 'operator'; value: string; pos: number }
  | { type: 'left'; pos: number }
  | { type: 'right'; pos: number }
  | { type: 'comma'; pos: number }
  | { type: 'bar'; pos: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index;
      while (end < source.length && /[0-9.]/.test(source[end])) end += 1;
      const raw = source.slice(index, end);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExpressionError(`数字格式无效：${raw}`);
      tokens.push({ type: 'number', value, pos: index });
      index = end;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let end = index;
      while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end += 1;
      tokens.push({ type: 'name', value: source.slice(index, end), pos: index });
      index = end;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === '<=' || two === '>=' || two === '&&') {
      tokens.push({ type: 'operator', value: two, pos: index });
      index += 2;
      continue;
    }
    if ('+-*/^<>'.includes(char)) {
      tokens.push({ type: 'operator', value: char, pos: index });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'left', pos: index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'right', pos: index });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', pos: index });
      index += 1;
      continue;
    }
    if (char === '|') {
      tokens.push({ type: 'bar', pos: index });
      index += 1;
      continue;
    }
    throw new ExpressionError(`不支持的字符：${char}`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  private barDepth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const node = this.parseAnd();
    if (this.peek()) {
      const token = this.peek()!;
      throw new ExpressionError(`表达式末尾存在多余内容（位置 ${token.pos}）`);
    }
    return node;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private matchOperator(value: string): boolean {
    const token = this.peek();
    if (token?.type === 'operator' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private match(type: Token['type']): boolean {
    if (this.peek()?.type === type) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private startsPrimary(): boolean {
    const token = this.peek();
    return token?.type === 'number' || token?.type === 'name' || token?.type === 'left' || (token?.type === 'bar' && this.barDepth === 0);
  }

  private parseAnd(): ExprNode {
    const items: ExprNode[] = [this.parseComparison()];
    while (this.matchOperator('&&')) items.push(this.parseComparison());
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  private parseComparison(): ExprNode {
    const first = this.parseAdditive();
    const comparisons: ExprNode[] = [];
    let previous = first;
    while (true) {
      const token = this.peek();
      if (token?.type !== 'operator' || !['<', '<=', '>', '>='].includes(token.value)) break;
      this.index += 1;
      const right = this.parseAdditive();
      comparisons.push({ kind: 'compare', op: token.value as '<' | '<=' | '>' | '>=', left: previous, right });
      previous = right;
    }
    if (comparisons.length === 0) return first;
    if (comparisons.length === 1) return comparisons[0];
    return { kind: 'and', items: comparisons };
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (true) {
      const token = this.peek();
      if (token?.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      this.index += 1;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op: token.value as '+' | '-', left, right };
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (token?.type === 'operator' && (token.value === '*' || token.value === '/')) {
        this.index += 1;
        const right = this.parseUnary();
        left = { kind: 'binary', op: token.value as '*' | '/', left, right };
        continue;
      }
      if (this.startsPrimary()) {
        const right = this.parseUnary();
        left = { kind: 'binary', op: '*', left, right };
        continue;
      }
      break;
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const token = this.peek();
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      this.index += 1;
      return { kind: 'unary', op: token.value, arg: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): ExprNode {
    const base = this.parsePrimary();
    if (this.matchOperator('^')) {
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();
    if (!token) throw new ExpressionError('表达式不完整');
    if (token.type === 'number') {
      this.index += 1;
      return { kind: 'num', value: token.value };
    }
    if (token.type === 'name') {
      this.index += 1;
      if (this.match('left')) {
        const args: ExprNode[] = [];
        if (!this.match('right')) {
          do {
            args.push(this.parseAnd());
          } while (this.match('comma'));
          if (!this.match('right')) throw new ExpressionError(`函数 ${token.value} 缺少右括号`);
        }
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'var', name: token.value };
    }
    if (token.type === 'left') {
      this.index += 1;
      const node = this.parseAnd();
      if (!this.match('right')) throw new ExpressionError('括号不匹配');
      return node;
    }
    if (token.type === 'bar') {
      this.index += 1;
      this.barDepth += 1;
      const node = this.parseAnd();
      if (!this.match('bar')) throw new ExpressionError('绝对值缺少结束 |');
      this.barDepth -= 1;
      return { kind: 'call', name: 'abs', args: [node] };
    }
    throw new ExpressionError(`无法解析的符号（位置 ${token.pos}）`);
  }
}

export function parseExpression(source: string): ExprNode {
  const text = source.trim();
  if (!text) throw new ExpressionError('表达式为空');
  return new Parser(tokenize(text)).parse();
}

export function isBuiltinFunction(name: string): boolean {
  return BUILTIN_FUNCTIONS.has(name);
}

function evaluateBuiltin(name: string, args: number[]): number {
  if (args.length !== 1) throw new ExpressionError(`函数 ${name} 只支持 1 个参数`);
  const value = args[0];
  switch (name) {
    case 'sin': return Math.sin(value);
    case 'cos': return Math.cos(value);
    case 'tan': return Math.tan(value);
    case 'sqrt': return Math.sqrt(value);
    case 'abs': return Math.abs(value);
    case 'log': return Math.log10(value);
    case 'ln': return Math.log(value);
    case 'exp': return Math.exp(value);
    case 'floor': return Math.floor(value);
    case 'ceil': return Math.ceil(value);
    case 'round': return Math.round(value);
    default: throw new ExpressionError(`未知函数：${name}`);
  }
}

function truthy(value: number): boolean {
  return Number.isFinite(value) && value !== 0;
}

export function evaluateNode(node: ExprNode, scope: Record<string, number>): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      if (node.name in scope) return scope[node.name];
      if (node.name in CONSTANTS) return CONSTANTS[node.name];
      throw new ExpressionError(`未知变量：${node.name}`);
    }
    case 'unary': {
      const value = evaluateNode(node.arg, scope);
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '^': return left ** right;
      }
    }
    case 'call': {
      const args = node.args.map((item) => evaluateNode(item, scope));
      if (!isBuiltinFunction(node.name)) throw new ExpressionError(`未知函数：${node.name}`);
      return evaluateBuiltin(node.name, args);
    }
    case 'compare': {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      switch (node.op) {
        case '<': return left < right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        default: return 0;
      }
    }
    case 'and':
      return node.items.every((item) => truthy(evaluateNode(item, scope))) ? 1 : 0;
    case 'piecewise': {
      for (const branch of node.branches) {
        if (truthy(evaluateNode(branch.when, scope))) return evaluateNode(branch.then, scope);
      }
      return node.fallback ? evaluateNode(node.fallback, scope) : Number.NaN;
    }
    default:
      throw new ExpressionError('未知表达式节点');
  }
}

export function compileExpression(source: string): ExpressionEvaluator {
  const ast = parseExpression(source);
  return (x: number, scope: Record<string, number> = {}) =>
    evaluateNode(ast, { ...scope, x });
}

const OPERATOR_PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
const COMPARE_PRECEDENCE = 0;

function serializeNode(node: ExprNode, parentPrecedence = 0): string {
  switch (node.kind) {
    case 'num':
      return String(node.value);
    case 'var':
      return node.name;
    case 'unary': {
      if (node.op === '-' && node.arg.kind === 'unary' && node.arg.op === '-') {
        return serializeNode(node.arg.arg, parentPrecedence);
      }
      const arg = serializeNode(node.arg, 4);
      const text = `${node.op}${arg}`;
      return 4 < parentPrecedence ? `(${text})` : text;
    }
    case 'binary': {
      // 展示层消掉双重负号：a-(-b) => a+b，a+(-b) => a-b。
      if (node.op === '-' && node.right.kind === 'unary' && node.right.op === '-') {
        return serializeNode({ kind: 'binary', op: '+', left: node.left, right: node.right.arg }, parentPrecedence);
      }
      if (node.op === '+' && node.right.kind === 'unary' && node.right.op === '-') {
        return serializeNode({ kind: 'binary', op: '-', left: node.left, right: node.right.arg }, parentPrecedence);
      }
      const precedence = OPERATOR_PRECEDENCE[node.op];
      const leftPrecedence = node.op === '^' ? precedence + 1 : precedence;
      const rightPrecedence = node.op === '^' || node.op === '+' || node.op === '*' ? precedence : precedence + 1;
      const left = serializeNode(node.left, leftPrecedence);
      const right = serializeNode(node.right, rightPrecedence);
      const text = `${left}${node.op}${right}`;
      return precedence < parentPrecedence ? `(${text})` : text;
    }
    case 'call':
      return `${node.name}(${node.args.map((item) => serializeNode(item)).join(',')})`;
    case 'compare': {
      const text = `${serializeNode(node.left, COMPARE_PRECEDENCE)}${node.op}${serializeNode(node.right, COMPARE_PRECEDENCE)}`;
      return COMPARE_PRECEDENCE < parentPrecedence ? `(${text})` : text;
    }
    case 'and': {
      const text = node.items.map((item) => serializeNode(item, 1)).join('&&');
      return parentPrecedence > 0 ? `(${text})` : text;
    }
    case 'piecewise':
      throw new ExpressionError('分段函数不能序列化为单一表达式');
    default:
      throw new ExpressionError('未知表达式节点');
  }
}

export function serializeExpression(node: ExprNode): string {
  return serializeNode(node);
}
export function collectVariables(node: ExprNode, output = new Set<string>()): Set<string> {
  switch (node.kind) {
    case 'var':
      output.add(node.name);
      break;
    case 'unary':
      collectVariables(node.arg, output);
      break;
    case 'binary':
      collectVariables(node.left, output);
      collectVariables(node.right, output);
      break;
    case 'call':
      node.args.forEach((item) => collectVariables(item, output));
      break;
    case 'compare':
      collectVariables(node.left, output);
      collectVariables(node.right, output);
      break;
    case 'and':
      node.items.forEach((item) => collectVariables(item, output));
      break;
    case 'piecewise':
      node.branches.forEach((branch) => {
        collectVariables(branch.when, output);
        collectVariables(branch.then, output);
      });
      if (node.fallback) collectVariables(node.fallback, output);
      break;
    default:
      break;
  }
  return output;
}

function replaceParams(node: ExprNode, map: Map<string, ExprNode>): ExprNode {
  switch (node.kind) {
    case 'var': return map.get(node.name) ?? node;
    case 'unary': return { ...node, arg: replaceParams(node.arg, map) };
    case 'binary': return { ...node, left: replaceParams(node.left, map), right: replaceParams(node.right, map) };
    case 'call': return { ...node, args: node.args.map((item) => replaceParams(item, map)) };
    case 'compare': return { ...node, left: replaceParams(node.left, map), right: replaceParams(node.right, map) };
    case 'and': return { ...node, items: node.items.map((item) => replaceParams(item, map)) };
    case 'piecewise':
      return {
        ...node,
        branches: node.branches.map((branch) => ({
          when: replaceParams(branch.when, map),
          then: replaceParams(branch.then, map),
        })),
        fallback: node.fallback ? replaceParams(node.fallback, map) : undefined,
      };
    default: return node;
  }
}

export function substituteVariables(node: ExprNode, values: Record<string, number>): ExprNode {
  const map = new Map<string, ExprNode>();
  for (const [name, value] of Object.entries(values)) map.set(name, { kind: 'num', value });
  return replaceParams(node, map);
}

export function substituteFunctions(
  node: ExprNode,
  definitions: Map<string, FunctionDefinition>,
  stack: string[] = [],
): ExprNode {
  switch (node.kind) {
    case 'num':
    case 'var':
      return node;
    case 'unary':
      return { ...node, arg: substituteFunctions(node.arg, definitions, stack) };
    case 'binary':
      return {
        ...node,
        left: substituteFunctions(node.left, definitions, stack),
        right: substituteFunctions(node.right, definitions, stack),
      };
    case 'compare':
      return {
        ...node,
        left: substituteFunctions(node.left, definitions, stack),
        right: substituteFunctions(node.right, definitions, stack),
      };
    case 'and':
      return { ...node, items: node.items.map((item) => substituteFunctions(item, definitions, stack)) };
    case 'piecewise':
      return {
        ...node,
        branches: node.branches.map((branch) => ({
          when: substituteFunctions(branch.when, definitions, stack),
          then: substituteFunctions(branch.then, definitions, stack),
        })),
        fallback: node.fallback ? substituteFunctions(node.fallback, definitions, stack) : undefined,
      };
    case 'call': {
      const args = node.args.map((item) => substituteFunctions(item, definitions, stack));
      const definition = definitions.get(node.name);
      if (!definition) {
        if (isBuiltinFunction(node.name)) return { ...node, args };
        throw new ExpressionError(`未知函数：${node.name}`);
      }
      if (stack.includes(node.name)) {
        throw new ExpressionError(`函数定义存在循环：${[...stack, node.name].join(' -> ')}`);
      }
      if (definition.params.length !== args.length) {
        throw new ExpressionError(`函数 ${node.name} 需要 ${definition.params.length} 个参数`);
      }
      const map = new Map<string, ExprNode>();
      definition.params.forEach((param, index) => map.set(param, args[index]));
      const replaced = replaceParams(definition.body, map);
      return substituteFunctions(replaced, definitions, [...stack, node.name]);
    }
    default:
      return node;
  }
}
