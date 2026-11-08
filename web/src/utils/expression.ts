type Token =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'comma' };

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'ln', 'exp', 'floor', 'ceil', 'round']);
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'u-': 4 };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index;
      while (end < expression.length && /[0-9.]/.test(expression[end])) end += 1;
      const value = Number(expression.slice(index, end));
      if (!Number.isFinite(value)) throw new Error('数字格式无效');
      tokens.push({ type: 'number', value });
      index = end;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let end = index;
      while (end < expression.length && /[a-zA-Z0-9_]/.test(expression[end])) end += 1;
      tokens.push({ type: 'name', value: expression.slice(index, end) });
      index = end;
      continue;
    }
    if ('+-*/^'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'left' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'right' });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma' });
      index += 1;
      continue;
    }
    throw new Error(`不支持的字符：${char}`);
  }
  return tokens;
}

function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: (Token & { function?: boolean })[] = [];
  let previous: Token | undefined;

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
    } else if (token.type === 'name') {
      if (FUNCTIONS.has(token.value)) stack.push({ ...token, function: true });
      else output.push(token);
    } else if (token.type === 'operator') {
      const unary = token.value === '-' && (!previous || previous.type === 'operator' || previous.type === 'left' || previous.type === 'comma');
      const operator = unary ? 'u-' : token.value;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type !== 'operator') break;
        const topPrecedence = PRECEDENCE[top.value] ?? 0;
        const precedence = PRECEDENCE[operator] ?? 0;
        if (topPrecedence > precedence || (topPrecedence === precedence && operator !== '^')) {
          output.push(stack.pop()!);
        } else {
          break;
        }
      }
      stack.push({ type: 'operator', value: operator });
    } else if (token.type === 'left') {
      stack.push(token);
    } else if (token.type === 'right') {
      while (stack.length && stack[stack.length - 1].type !== 'left') output.push(stack.pop()!);
      if (!stack.length) throw new Error('括号不匹配');
      stack.pop();
      const top = stack[stack.length - 1];
      if (top && top.type === 'name' && top.function) output.push(stack.pop()!);
    } else if (token.type === 'comma') {
      while (stack.length && stack[stack.length - 1].type !== 'left') output.push(stack.pop()!);
      if (!stack.length) throw new Error('函数参数格式错误');
    }
    previous = token;
  }
  while (stack.length) {
    const token = stack.pop()!;
    if (token.type === 'left') throw new Error('括号不匹配');
    output.push(token);
  }
  return output;
}

export function compileExpression(expression: string): (x: number, y?: number) => number {
  const rpn = toRpn(tokenize(expression));
  return (x: number, y = 0) => {
    const stack: number[] = [];
    for (const token of rpn) {
      if (token.type === 'number') {
        stack.push(token.value);
      } else if (token.type === 'name') {
        if (FUNCTIONS.has(token.value)) {
          const argument = stack.pop();
          if (argument === undefined) throw new Error(`函数 ${token.value} 缺少参数`);
          stack.push(evaluateFunctionName(token.value, argument));
        } else if (token.value === 'x') {
          stack.push(x);
        } else if (token.value === 'y') {
          stack.push(y);
        } else if (token.value in CONSTANTS) {
          stack.push(CONSTANTS[token.value]);
        } else {
          throw new Error(`未知变量：${token.value}`);
        }
      } else if (token.type === 'operator') {
        if (token.value === 'u-') {
          const value = stack.pop();
          if (value === undefined) throw new Error('表达式缺少操作数');
          stack.push(-value);
          continue;
        }
        const right = stack.pop();
        const left = stack.pop();
        if (left === undefined || right === undefined) throw new Error('表达式缺少操作数');
        switch (token.value) {
          case '+':
            stack.push(left + right);
            break;
          case '-':
            stack.push(left - right);
            break;
          case '*':
            stack.push(left * right);
            break;
          case '/':
            stack.push(left / right);
            break;
          case '^':
            stack.push(left ** right);
            break;
          default:
            throw new Error(`未知运算符：${token.value}`);
        }
      } else {
        throw new Error('表达式格式错误');
      }
    }
    if (stack.length !== 1) throw new Error('表达式格式错误');
    return stack[0];
  };
}

export function evaluateFunction(expression: string, value: number): number {
  const compiled = compileExpression(expression);
  return compiled(value);
}

export function evaluateFunctionName(name: string, value: number): number {
  switch (name) {
    case 'sin':
      return Math.sin(value);
    case 'cos':
      return Math.cos(value);
    case 'tan':
      return Math.tan(value);
    case 'sqrt':
      return Math.sqrt(value);
    case 'abs':
      return Math.abs(value);
    case 'log':
      return Math.log10(value);
    case 'ln':
      return Math.log(value);
    case 'exp':
      return Math.exp(value);
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'round':
      return Math.round(value);
    default:
      throw new Error(`未知函数：${name}`);
  }
}
