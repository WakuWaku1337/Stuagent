import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-viz-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const {
  VisualizationError,
  createVisualization,
  createVisualizeTool,
  deleteVisualization,
  getVisualization,
  listVisualizations,
} = await import('../src/learning/visualize.ts');
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

  report(deleteVisualization(functionViz.visualization_id), 'delete visualization');
  report(listVisualizations().length === 1, 'list after delete');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
