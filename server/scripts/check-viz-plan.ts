import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-viz-plan-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const { getVisualization } = await import('../src/learning/visualize.ts');
const { generateVisualization, createVisualizeTool } = await import('../src/learning/visualize-engine.ts');
const { modelVisualization } = await import('../src/learning/visualize-modeler.ts');
const { functionGraphDocumentFromModeled, conicDocumentFromModeled } = await import('../src/learning/viz/function-scene.ts');
const { validateVizDocument } = await import('../../shared/viz/schema.ts');
const { compileExpression } = await import('../../shared/expression.ts');
const { compileCartesian } = await import('../../shared/viz/cartesian.ts');
const { VIZ_PRESETS, presetDocument } = await import('../src/learning/visualize-presets.ts');

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
function expectCode(action: () => unknown, code: string): boolean {
  try {
    action();
    return false;
  } catch (error) {
    return (error as { code?: string }).code === code;
  }
}
function hasStyleKey(value: unknown): boolean {
  const forbidden = new Set(['fill', 'stroke', 'attr', 'color', 'style', 'opacity', 'lineWidth']);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasStyleKey);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => forbidden.has(key) || hasStyleKey(child));
}

try {
  const generated = await generateVisualization({ question: '画出函数 y=x^2-4x+3 的图像', subject: '数学' });
  const doc = generated?.visualization.spec as any;
  const rendered = doc ? compileCartesian(doc, { width: 900, height: 420 }) : null;
  report(
    generated?.visualization.schema_version === 2 &&
      doc?.schema === 'edupi.viz/v2' &&
      doc?.kind === 'function-graph' &&
      !hasStyleKey(doc.scene) &&
      rendered?.curves.length === 1 &&
      rendered.points.length >= 3,
    'modeler writes v2 function doc and compiles roots/extrema',
    `points=${rendered?.points.length ?? 0}`,
  );
  report(
    !!generated && getVisualization(generated.visualization.visualization_id)?.input_text === '画出函数 y=x^2-4x+3 的图像',
    'v2 document stores input_text',
  );

  const composite = modelVisualization('已知 g(x)=|x-3|-|x+3|，画出函数 f(x)=g(x)g(|x|) 的图像', '数学');
  const compositeDoc = composite ? functionGraphDocumentFromModeled(composite, '已知 g(x)=|x-3|-|x+3|，画出函数 f(x)=g(x)g(|x|) 的图像', '数学') : null;
  const compositeRender = compositeDoc ? compileCartesian(compositeDoc, { width: 900, height: 420 }) : null;
  report(
    !!compositeDoc &&
      compositeRender?.curves.length === 2 &&
      !(compositeDoc.scene as any).parameters.some((item: { name: string }) => item.name === 'g'),
    'composition is expanded and function name is not a slider',
  );

  const piecewiseQuestion = '画出分段函数 f(x)=\\begin{cases}6, & x<=-3\\\\-2x, & -3<x<3\\\\-6, & x>=3\\end{cases} 的图像';
  const piecewise = modelVisualization(piecewiseQuestion, '数学');
  const piecewiseDoc = piecewise ? functionGraphDocumentFromModeled(piecewise, piecewiseQuestion, '数学') : null;
  const piecewiseRender = piecewiseDoc ? compileCartesian(piecewiseDoc, { width: 900, height: 420 }) : null;
  report(
    !!piecewiseDoc &&
      (piecewiseDoc.scene as any).definitions[0]?.piecewise?.length === 3 &&
      !!piecewiseRender?.curves.length,
    'piecewise document compiles',
  );

  const conic = modelVisualization('椭圆 x^2/9+y^2/4=1', '数学');
  const conicDoc = conic ? conicDocumentFromModeled(conic, '椭圆 x^2/9+y^2/4=1', '数学') : null;
  const conicRender = conicDoc ? compileCartesian(conicDoc, { width: 900, height: 420 }) : null;
  report(!!conicDoc && (conicRender?.conicSegments.length ?? 0) > 0, 'conic v2 compiles marching-squares segments');

  const styleDoc = JSON.parse(JSON.stringify(doc));
  styleDoc.scene.curves[0].fill = '#409eff';
  report(expectCode(() => validateVizDocument(styleDoc), 'VIZ_STYLE_FORBIDDEN'), 'reject style fields in v2 scene');

  const badRegionDoc = JSON.parse(JSON.stringify(doc));
  badRegionDoc.scene.regions = [{
    kind: 'between',
    lower: { kind: 'constant', value: -2 },
    upper: { kind: 'constant', value: 2 },
    role: 'solution',
  }];
  report(expectCode(() => validateVizDocument(badRegionDoc), 'VIZ_REGION_INVALID'), 'reject constant-true region');

  const tool = createVisualizeTool();
  let specRejected = false;
  try {
    await tool.execute('test', { question: '画出 y=x^2 的图像', spec: { expression: 'x^2', range: [-2, 2] } });
  } catch (error) {
    specRejected = (error as { code?: string }).code === 'VIZ_AGENT_SPEC_FORBIDDEN';
  }
  report(specRejected, 'agent tool rejects raw spec');

  const unsupported = await generateVisualization({ question: '今天天气不错', subject: '数学' });
  report(unsupported === null, 'unsupported non-structural question does not fall back to a model spec');

  const nestedAbs = compileExpression('||x|-3|');
  report(nestedAbs(-2) === 1 && nestedAbs(0) === 3, 'native nested absolute value');

  const cube = await generateVisualization({ question: '正方体 ABCD-A1B1C1D1，E 为 BB1 中点，过 A、C、E 作截面，棱长 2', subject: '数学' });
  report(cube?.visualization.schema_version === 2 && cube.visualization.spec.kind === 'solid-geometry', 'geometry uses strict v2 scene');

  const preset = await generateVisualization({ question: '正弦函数图像', subject: '数学' });
  report(preset?.matched === 'preset' && preset.visualization.schema_version === 2 && preset.visualization.spec.kind === 'function-graph', 'preset writes native v2');
  const presetQuestion = '等高线地形';
  const presetWithQuestion = await generateVisualization({ question: presetQuestion, subject: '地理' });
  report(presetWithQuestion?.matched === 'preset' && getVisualization(presetWithQuestion.visualization.visualization_id)?.input_text === presetQuestion, 'fresh preset keeps original question as input_text');

  const presetFailures = VIZ_PRESETS.filter((item) => {
    try {
      const presetV2 = presetDocument(item);
      return presetV2.schema !== 'edupi.viz/v2' || presetV2.diagnostics.some((diag) => diag.code === 'VIZ_LEGACY_SPEC');
    } catch {
      return true;
    }
  });
  report(presetFailures.length === 0, 'all presets are native v2 scenes', `count=${VIZ_PRESETS.length}`);

  const moleculeDoc = {
    schema: 'edupi.viz/v2',
    kind: 'molecule',
    title: '测试分子',
    input: { text: 'H2' },
    provenance: { generator: 'manual', version: 'test@1' },
    scene: { format: 'xyz', style: 'stick', data: '1\nH\nH 0 0 0\n' },
    diagnostics: [],
  };
  report(validateVizDocument(moleculeDoc).kind === 'molecule', 'strict molecule scene validates');
  const badMolecule = JSON.parse(JSON.stringify(moleculeDoc));
  badMolecule.scene.fill = '#000';
  report(expectCode(() => validateVizDocument(badMolecule), 'VIZ_SCENE_INVALID'), 'reject unknown molecule scene fields');

  const badGeometry = {
    schema: 'edupi.viz/v2',
    kind: 'solid-geometry',
    title: '测试几何',
    input: { text: '正方体' },
    provenance: { generator: 'manual', version: 'test@1' },
    scene: { points: [{ id: 'A', coord: [0, 0, 0] }], edges: [], faces: [], auxiliary: [], labels: true, style: 'x' },
    diagnostics: [],
  };
  report(expectCode(() => validateVizDocument(badGeometry), 'VIZ_SCENE_INVALID'), 'reject unknown solid-geometry fields');

  const yRegionDoc = {
    schema: 'edupi.viz/v2',
    kind: 'function-graph',
    title: '水平带区域',
    input: { text: '0<y<1' },
    provenance: { generator: 'manual', version: 'test@1' },
    scene: {
      definitions: [{ name: 'f', params: ['x'], body: 'x', display: 'y=x' }],
      curves: [{ def: 'f', role: 'primary', visible: true }],
      parameters: [],
      view: { x: [-2, 2], y: [-2, 2], mode: 'fixed' },
      features: [],
      regions: [{ kind: 'condition', condition: 'y > 0 && y < 1', axis: 'y', role: 'solution' }],
    },
    diagnostics: [],
  };
  const yRegionModel = compileCartesian(validateVizDocument(yRegionDoc), { width: 720, height: 420 });
  const yBand = yRegionModel.regions[0]?.polygon ?? [];
  report(
    yBand.length >= 4 && yBand.every((point) => point.y >= 0 && point.y <= 1) && yBand.some((point) => point.x === -2) && yBand.some((point) => point.x === 2),
    'condition region supports horizontal (y-axis) bands',
  );

  const wrongAxisDoc = JSON.parse(JSON.stringify(yRegionDoc));
  wrongAxisDoc.scene.regions[0].condition = 'x > 0';
  report(expectCode(() => validateVizDocument(wrongAxisDoc), 'VIZ_REGION_INVALID'), 'reject x condition on y axis');

  const coverageQuestions = [
    '水分子的空间构型',
    '斜面上物体的受力分析',
    '动物细胞结构',
    '直角三角形两直角边 3 和 4',
    '圆柱半径 2，高 5',
    '等高线地形',
  ];
  const coverageFailures: string[] = [];
  for (const question of coverageQuestions) {
    try {
      const result = await generateVisualization({ question });
      if (!result) {
        coverageFailures.push(`${question}: null`);
        continue;
      }
      validateVizDocument(result.visualization.spec);
      if (result.visualization.schema_version !== 2) coverageFailures.push(`${question}: schema_version`);
    } catch (error) {
      coverageFailures.push(`${question}: ${(error as Error).message}`);
    }
  }
  report(coverageFailures.length === 0, 'all kind families write strict v2 documents', coverageFailures.join('; '));

  let ambiguousCode = '';
  try {
    await generateVisualization({ question: '已知 f(x)=x^2，g(x)=x+1', subject: '数学' });
  } catch (error) {
    ambiguousCode = (error as { code?: string }).code ?? '';
  }
  report(ambiguousCode === 'VIZ_AMBIGUOUS_TARGET', 'ambiguous target returns structured code');

  const piecewiseCompositionQuestion = '已知 g(x)=\\begin{cases}x, & x>=0\\\\-x, & x<0\\end{cases}，画出 f(x)=g(x) 的图像';
  const piecewiseComposition = modelVisualization(piecewiseCompositionQuestion, '数学');
  const piecewiseCompositionDoc = piecewiseComposition ? functionGraphDocumentFromModeled(piecewiseComposition, piecewiseCompositionQuestion, '数学') : null;
  const piecewiseCompositionRender = piecewiseCompositionDoc ? compileCartesian(piecewiseCompositionDoc, { width: 900, height: 420 }) : null;
  report(!!piecewiseCompositionDoc && !!piecewiseCompositionRender?.curves.length, 'top-level piecewise composition compiles');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
