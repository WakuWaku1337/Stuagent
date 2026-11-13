import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-viz-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const {
  VisualizationError,
  createVisualization,
  deleteVisualization,
  getVisualization,
  listVisualizations,
} = await import('../src/learning/visualize.ts');
const { createVisualizeTool } = await import('../src/learning/visualize-engine.ts');
const { generateVisualization } = await import('../src/learning/visualize-engine.ts');
const { modelVisualization } = await import('../src/learning/visualize-modeler.ts');
const { compileExpression } = await import('../../web/src/utils/expression.ts');

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

function expectError(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

try {
  const fn = compileExpression('x^2 + 1');
  report(fn(2) === 5 && Math.abs(compileExpression('sin(pi/2)')(0) - 1) < 1e-9, 'safe expression evaluator');
  report(expectError(() => compileExpression('x +')(1)), 'invalid expression rejected');

  const functionViz = createVisualization({
    type: 'function2d',
    title: '二次函数',
    spec: { expression: 'x^2 - 4', variable: 'x', range: [-6, 6] },
  });
  report(
    functionViz.type === 'function2d' &&
      functionViz.title === '二次函数' &&
      (functionViz.spec.range as number[]).join(',') === '-6,6',
    'create function visualization',
  );

  const cube = createVisualization({
    type: 'geometry3d',
    title: '正方体',
    spec: {
      points: [
        { id: 'A', coord: [0, 0, 0] },
        { id: 'B', coord: [1, 0, 0] },
        { id: 'C', coord: [1, 1, 0] },
        { id: 'D', coord: [0, 1, 0] },
        { id: 'E', coord: [0, 0, 1] },
        { id: 'F', coord: [1, 0, 1] },
        { id: 'G', coord: [1, 1, 1] },
        { id: 'H', coord: [0, 1, 1] },
      ],
      edges: [['A', 'B'], ['B', 'C']],
      faces: [['A', 'B', 'C', 'D']],
    },
  });
  report(cube.type === 'geometry3d' && listVisualizations().length === 2, 'create geometry visualization');
  report(getVisualization(cube.visualization_id)?.title === '正方体', 'get visualization');

  report(expectError(() => createVisualization({ type: 'function2d', title: '', spec: { expression: 'x', range: [0, 1] } })), 'reject empty title');
  report(expectError(() => createVisualization({ type: 'function2d', title: '坏区间', spec: { expression: 'x', range: [1, 1] } })), 'reject invalid range');
  report(
    expectError(() =>
      createVisualization({
        type: 'geometry3d',
        title: '坏几何',
        spec: { points: [{ id: 'A', coord: [0, 0, 0] }] },
      }),
    ),
    'reject invalid geometry',
  );

  const tool = createVisualizeTool();
  report(tool.name === 'visualize_generate', 'agent tool registered');

  const functionModel = modelVisualization('画出函数 y=x^2-4x+3 的图像', '数学');
  const functionSpec = functionModel?.spec as Record<string, unknown> | undefined;
  const modeledFunctions = (functionSpec?.functions ?? []) as { expression: string; label: string }[];
  report(
    functionModel?.type === 'function2d' &&
      modeledFunctions[0]?.expression === 'x^2-4*x+3' &&
      (functionSpec?.range as number[]).join(',') === '-2,6',
    'model function from actual expression',
    modeledFunctions[0]?.label,
  );

  const absModel = modelVisualization('画出函数 y=|x| 的图像', '数学');
  const absFn = (absModel?.spec.functions ?? []) as { expression: string }[];
  const absEvaluator = compileExpression(absFn[0]?.expression ?? '');
  report(
    absFn[0]?.expression === 'abs(x)' &&
      absEvaluator(-2) === 2 &&
      absEvaluator(0) === 0 &&
      absEvaluator(2) === 2,
    'model absolute value without function-call corruption',
    absFn[0]?.expression,
  );

  const sinModel = modelVisualization('画出函数 y=sin(x)+1 的图像', '数学');
  const sinFn = (sinModel?.spec.functions ?? []) as { expression: string }[];
  const sinEvaluator = compileExpression(sinFn[0]?.expression ?? '');
  report(
    sinFn[0]?.expression === 'sin(x)+1' && Math.abs(sinEvaluator(0) - 1) < 1e-9,
    'model trigonometric function without function-call corruption',
    sinFn[0]?.expression,
  );

  const compositeModel = modelVisualization('已知 g(x)=|x-3|-|x+3|，画出函数 f(x)=g(x)g(|x|) 的图像', '数学');
  const compositeSpec = compositeModel?.spec as Record<string, unknown> | undefined;
  const compositeFns = (compositeSpec?.functions ?? []) as { expression: string; label: string }[];
  const compositeTarget = compositeFns.find((item) => item.label.startsWith('f('));
  const compositeEvaluator = compileExpression(compositeTarget?.expression ?? '');
  const compositeSliders = (compositeSpec?.sliders ?? []) as { param: string }[];
  report(
    Boolean(compositeTarget) &&
      !compositeTarget!.expression.includes('g(') &&
      compositeEvaluator(0) === 0 &&
      compositeEvaluator(1) === 4 &&
      compositeEvaluator(4) === 36 &&
      compositeSliders.every((item) => item.param !== 'g'),
    'resolve function composition and exclude function names from sliders',
    compositeTarget?.expression,
  );

  const piecewiseQuestion =
    '画出分段函数 f(x)=\\begin{cases}6, & x<=-3\\\\-2x, & -3<x<3\\\\-6, & x>=3\\end{cases} 的图像';
  const piecewiseModel = modelVisualization(piecewiseQuestion, '数学');
  const piecewiseFns = (piecewiseModel?.spec.functions ?? []) as {
    piecewise?: { when: string; then: string }[];
  }[];
  const branches = piecewiseFns[0]?.piecewise ?? [];
  const evaluatePiecewise = (x: number): number => {
    for (const branch of branches) {
      if (compileExpression(branch.when)(x) !== 0) return compileExpression(branch.then)(x);
    }
    return Number.NaN;
  };
  report(
    branches.length === 3 &&
      evaluatePiecewise(-4) === 6 &&
      evaluatePiecewise(0) === 0 &&
      evaluatePiecewise(4) === -6,
    'parse and evaluate three-branch piecewise function',
    JSON.stringify(branches),
  );

  const piecewiseViz = createVisualization({
    type: 'function2d',
    title: '分段函数',
    spec: {
      functions: [
        {
          label: 'f(x)=分段函数',
          piecewise: [
            { when: 'x<=-3', then: '6' },
            { when: '(-3<x)&&(x<3)', then: '-2*x' },
            { when: 'x>=3', then: '-6' },
          ],
        },
      ],
      range: [-8, 8],
    },
  });
  report(
    Array.isArray(piecewiseViz.spec.functions) &&
      (piecewiseViz.spec.functions as { piecewise?: unknown[] }[])[0]?.piecewise?.length === 3,
    'create piecewise visualization through validation',
  );
  report(
    expectError(() =>
      createVisualization({
        type: 'function2d',
        title: '坏函数',
        spec: { expression: 'abs*(x)', range: [-2, 2] },
      }),
    ),
    'reject uncompilable function expression',
  );
  const intersectionModel = modelVisualization('二次函数 y=2x+1 与 y=x^2 的交点', '数学');
  const relations = (intersectionModel?.spec.relations ?? []) as { solve: string }[];
  report(
    ((intersectionModel?.spec.functions ?? []) as unknown[]).length === 2 &&
      relations[0]?.solve === '2*x+1=x^2',
    'model two functions and intersection',
    relations[0]?.solve,
  );

  const cubeModel = modelVisualization('正方体 ABCD-A1B1C1D1 中，E 为 BB1 的中点，过 A、C、E 作截面，棱长为 2', '数学');
  const cubePoints = (cubeModel?.spec.points ?? []) as { id: string; coord: number[] }[];
  const cubeAux = (cubeModel?.spec.auxiliary ?? []) as { kind: string; points: string[] }[];
  report(
    cubeModel?.type === 'geometry3d' &&
      cubePoints.find((point) => point.id === 'E')?.coord.join(',') === '2,0,1' &&
      cubeAux.some((item) => item.kind === 'plane' && item.points.join(',') === 'A,C,E'),
    'model cube midpoint and section from actual points',
  );

  const feedModel = modelVisualization('打印机进纸时，滚轮压住第1张纸，摩擦片压住最下层纸，分析层间摩擦力', '物理');
  const feedText = JSON.stringify(feedModel?.spec ?? {});
  report(
    feedModel?.type === 'physics' && feedText.includes('滚轮') && feedText.includes('摩擦片') && feedText.includes('层间摩擦'),
    'model printer feed friction scenario',
  );

  const moleculeModel = modelVisualization('水分子 H2O 的键角', '化学');
  report(
    moleculeModel?.type === 'molecule' &&
      String(moleculeModel.spec.data).startsWith('3\n') &&
      String(moleculeModel.spec.data).includes('O 0 0 0'),
    'model molecule from formula',
  );

  const planeModel = modelVisualization('直角三角形两直角边分别为 3 和 4，求斜边', '数学');
  const planeText = JSON.stringify(planeModel?.spec ?? {});
  report(
    planeModel?.type === 'diagram' && planeText.includes('斜边 5') && planeText.includes('90°'),
    'model right triangle from actual side lengths',
  );

  report(modelVisualization('今天天气不错') === null, 'modeler rejects unrelated question');

  const generated = await generateVisualization({ question: '斜面上质量 2kg 的物体，倾角 30°，摩擦因数 0.2' });
  report(
    generated?.matched === 'modeled' &&
      generated.visualization.source === 'modeler' &&
      generated.visualization.type === 'physics',
    'generate uses local modeler without LLM',
    generated?.basis,
  );

  report(deleteVisualization(functionViz.visualization_id), 'delete visualization');
  report(
    !listVisualizations().some((item) => item.visualization_id === functionViz.visualization_id),
    'list after delete',
  );

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
