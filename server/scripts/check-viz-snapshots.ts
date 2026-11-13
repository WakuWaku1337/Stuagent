import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { modelVisualization } from '../src/learning/visualize-modeler.ts';
import { functionGraphDocumentFromModeled, conicDocumentFromModeled } from '../src/learning/viz/function-scene.ts';
import { presetDocument, VIZ_PRESETS } from '../src/learning/visualize-presets.ts';
import { compileCartesian } from '../../shared/viz/cartesian.ts';
import { renderCartesianSvg } from '../../shared/viz/svg.ts';

const update = process.argv.includes('--update');
const width = 720;
const height = 420;
const fixtureDir = new URL('../testdata/viz/', import.meta.url);
const baselineDir = new URL('../testdata/viz/snapshots/', import.meta.url);
const actualDir = new URL('../data/viz-snapshots/', import.meta.url);
const baselinePath = (name: string) => new URL(`${name}.png`, baselineDir);
const actualPath = (name: string) => new URL(`${name}.actual.png`, actualDir);

if (!existsSync(baselineDir)) mkdirSync(baselineDir, { recursive: true });
if (!existsSync(actualDir)) mkdirSync(actualDir, { recursive: true });

function docFor(question: string) {
  const modeled = modelVisualization(question, '数学');
  if (!modeled) return null;
  return modeled.type === 'conic'
    ? conicDocumentFromModeled(modeled, question, '数学')
    : functionGraphDocumentFromModeled(modeled, question, '数学');
}

async function raster(svg: string): Promise<{ data: Uint8ClampedArray; png: Buffer }> {
  const image = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, png: canvas.toBuffer('image/png') };
}

function diffRatio(current: Uint8ClampedArray, baseline: Uint8ClampedArray): number {
  if (current.length !== baseline.length) return 1;
  let changed = 0;
  for (let index = 0; index < current.length; index += 4) {
    const delta = Math.max(
      Math.abs(current[index] - baseline[index]),
      Math.abs(current[index + 1] - baseline[index + 1]),
      Math.abs(current[index + 2] - baseline[index + 2]),
    );
    if (delta > 24) changed += 1;
  }
  return changed / (current.length / 4);
}

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const cases: { name: string; svg: string }[] = [];
for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort()) {
  const fixture = JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8')) as { name: string; question: string };
  const doc = docFor(fixture.question);
  if (!doc) {
    report(false, `snapshot source: ${fixture.name}`, 'modeler returned null');
    continue;
  }
  const model = compileCartesian(doc, { width, height });
  cases.push({ name: fixture.name, svg: renderCartesianSvg(model, { width, height }) });
}
for (const preset of VIZ_PRESETS.filter((item) => item.type === 'function2d' || item.type === 'conic')) {
  const model = compileCartesian(presetDocument(preset), { width, height });
  cases.push({ name: `preset-${preset.id}`, svg: renderCartesianSvg(model, { width, height }) });
}

for (const item of cases) {
  const current = await raster(item.svg);
  const path = baselinePath(item.name);
  if (!existsSync(path)) {
    if (update) {
      writeFileSync(path, current.png);
      report(true, `snapshot created: ${item.name}`, 'baseline written');
    } else {
      writeFileSync(actualPath(item.name), current.png);
      report(false, `snapshot baseline missing: ${item.name}`, 'run with --update');
    }
    continue;
  }
  const baselineImage = await loadImage(readFileSync(path));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baselineImage, 0, 0, width, height);
  const baseline = ctx.getImageData(0, 0, width, height).data;
  const ratio = diffRatio(current.data, baseline);
  if (ratio > 0.01) writeFileSync(actualPath(item.name), current.png);
  report(ratio <= 0.01, `pixel snapshot: ${item.name}`, `diff=${(ratio * 100).toFixed(3)}%`);
}

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
if (failures) console.log('失败时实际渲染图保存在 server/data/viz-snapshots/。');
process.exitCode = failures === 0 ? 0 : 1;
