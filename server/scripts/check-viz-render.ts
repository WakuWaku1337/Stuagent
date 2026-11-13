import { readFileSync, readdirSync } from 'node:fs';
import { modelVisualization } from '../src/learning/visualize-modeler.ts';
import { functionGraphDocumentFromModeled, conicDocumentFromModeled } from '../src/learning/viz/function-scene.ts';
import { compileCartesian } from '../../shared/viz/cartesian.ts';

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
function docFor(question: string) {
  const modeled = modelVisualization(question, '数学');
  if (!modeled) return null;
  return modeled.type === 'conic'
    ? conicDocumentFromModeled(modeled, question, '数学')
    : functionGraphDocumentFromModeled(modeled, question, '数学');
}
function finitePoints(model: ReturnType<typeof compileCartesian>): boolean {
  return model.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) &&
    model.curves.every((curve) => curve.segments.every((segment) => segment.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))));
}

try {
  const quadratic = docFor('画出函数 y=x^2-4x+3 的图像');
  const quadraticModel = quadratic ? compileCartesian(quadratic, { width: 900, height: 420 }) : null;
  report(
    !!quadraticModel && quadraticModel.curves[0]?.segments.length === 1 && quadraticModel.points.length >= 3 && finitePoints(quadraticModel),
    'quadratic curve has finite segments and roots/extrema',
    `points=${quadraticModel?.points.length ?? 0}`,
  );

  const abs = docFor('画出函数 y=|x| 的图像');
  const absModel = abs ? compileCartesian(abs, { width: 900, height: 420 }) : null;
  report(!!absModel && absModel.curves[0]?.segments.length === 1 && finitePoints(absModel), 'absolute-value curve renders');

  const region = docFor('x^2-3x+2>0');
  const regionModel = region ? compileCartesian(region, { width: 900, height: 420 }) : null;
  report(!!regionModel && regionModel.regions.length === 2, 'inequality region only covers solution intervals');

  const chainQuestion = '已知 f(x)=x^2-3x+2，-1<f(x)<2';
  const chain = docFor(chainQuestion);
  const chainModel = chain ? compileCartesian(chain, { width: 900, height: 420 }) : null;
  report(
    !!chainModel && chainModel.regions.length >= 1 && chainModel.regions.every((item) => item.polygon.length >= 4),
    'chained condition becomes a bounded region',
  );

  const piecewiseQuestion = '画出分段函数 f(x)=\\begin{cases}6, & x<=-3\\\\-2x, & -3<x<3\\\\-6, & x>=3\\end{cases} 的图像';
  const piecewise = docFor(piecewiseQuestion);
  const piecewiseModel = piecewise ? compileCartesian(piecewise, { width: 900, height: 420 }) : null;
  report(!!piecewiseModel && !!piecewiseModel.curves.length && finitePoints(piecewiseModel), 'piecewise curve renders without NaN');

  const conicQuestion = '椭圆 x^2/9+y^2/4=1';
  const conic = docFor(conicQuestion);
  const conicModel = conic ? compileCartesian(conic, { width: 900, height: 420 }) : null;
  report(!!conicModel && conicModel.conicSegments.length > 0, 'conic segments are finite');

  const coarseConic = conic ? compileCartesian(conic, { width: 360, height: 420 }) : null;
  const fineConic = conic ? compileCartesian(conic, { width: 1440, height: 420 }) : null;
  const conicFinite = (model: ReturnType<typeof compileCartesian> | null) =>
    !!model && model.conicSegments.every((segment) =>
      Number.isFinite(segment.from.x) && Number.isFinite(segment.from.y) &&
      Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y));
  report(
    conicFinite(coarseConic) && conicFinite(fineConic) &&
      (fineConic?.conicSegments.length ?? 0) > (coarseConic?.conicSegments.length ?? 0),
    'conic marching squares adapts to resolution',
    `coarse=${coarseConic?.conicSegments.length ?? 0} fine=${fineConic?.conicSegments.length ?? 0}`,
  );

  const expectedQuestion = '已知 f(x)=(x+1)(x-1)(x-2)，求 f(x) 的三个零点';
  const expected = docFor(expectedQuestion);
  const expectedModel = expected ? compileCartesian(expected, { width: 900, height: 420 }) : null;
  const mismatch = expectedModel?.diagnostics.some((item) => item.code === 'VIZ_FEATURE_COUNT_MISMATCH') ?? false;
  report(!!expectedModel && expectedModel.points.filter((point) => point.kind === 'root').length === 3 && !mismatch, 'expected root count is verified');

  const fixtureDir = new URL('../testdata/viz/', import.meta.url);
  for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort()) {
    const fixture = JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8')) as {
      name: string;
      question: string;
      expected: { curves?: number; roots?: number; extrema?: number; regions?: number; conicSegments?: number };
    };
    const fixtureDoc = docFor(fixture.question);
    const fixtureModel = fixtureDoc ? compileCartesian(fixtureDoc, { width: 900, height: 420 }) : null;
    const roots = fixtureModel?.points.filter((point) => point.kind === 'root').length ?? -1;
    const extrema = fixtureModel?.points.filter((point) => point.kind === 'extremum').length ?? -1;
    const expected = fixture.expected;
    report(
      !!fixtureModel &&
        (expected.curves === undefined || fixtureModel.curves.length === expected.curves) &&
        (expected.roots === undefined || roots === expected.roots) &&
        (expected.extrema === undefined || extrema === expected.extrema) &&
        (expected.regions === undefined || fixtureModel.regions.length === expected.regions) &&
        (expected.conicSegments === undefined || fixtureModel.conicSegments.length >= expected.conicSegments),
      `golden fixture: ${fixture.name}`,
      `curves=${fixtureModel?.curves.length ?? 0} roots=${roots} extrema=${extrema} regions=${fixtureModel?.regions.length ?? 0} conic=${fixtureModel?.conicSegments.length ?? 0}`,
    );
  }

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
