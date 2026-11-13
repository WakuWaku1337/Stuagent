import { clampText, normalizeExpression, normalizeText, type ModeledVisualization } from './core.ts';

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

export { modelConic };
