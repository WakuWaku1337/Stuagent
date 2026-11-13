import type { CartesianRenderModel, RenderCurve, RenderRegion } from './types';

export interface SvgRenderOptions {
  width?: number;
  height?: number;
  showLabels?: boolean;
}

const ROLE_COLORS = {
  primary: '#409eff',
  secondary: '#f56c6c',
  reference: '#8a94a6',
} as const;

function niceStep(span: number, count: number): number {
  const rough = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const normalized = rough / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * power;
}

function ticks(min: number, max: number, count: number): number[] {
  const step = niceStep(max - min, count);
  const start = Math.ceil(min / step) * step;
  const output: number[] = [];
  for (let value = start; value <= max + step * 0.001; value += step) output.push(Number(value.toFixed(10)));
  return output;
}

function tickLabel(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  return Number(value.toFixed(3)).toString();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char] ?? char);
}

/**
 * 与 CartesianPlot.vue 相同的坐标、裁剪和图层顺序，输出确定性 SVG。
 * 用于 CI 中的像素级视觉回归；浏览器组件仍负责交互（滑块/隐藏曲线）。
 */
export function renderCartesianSvg(model: CartesianRenderModel, options: SvgRenderOptions = {}): string {
  const width = options.width ?? 720;
  const height = options.height ?? 420;
  const margin = { left: 48, right: 18, top: 14, bottom: 34 };
  const plotWidth = Math.max(80, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const xScale = (x: number) => margin.left + ((x - model.view.x[0]) / (model.view.x[1] - model.view.x[0])) * plotWidth;
  const yScale = (y: number) => margin.top + ((model.view.y[1] - y) / (model.view.y[1] - model.view.y[0])) * plotHeight;
  const curvePath = (curve: RenderCurve) => curve.segments
    .map((segment) => segment.map((point, index) => `${index === 0 ? 'M' : 'L'}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(' '))
    .join(' ');
  const regionPath = (region: RenderRegion) => region.polygon.length
    ? `${region.polygon.map((point, index) => `${index === 0 ? 'M' : 'L'}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(' ')} Z`
    : '';
  const conicPath = model.conicSegments
    .map((segment) => `M${xScale(segment.from.x).toFixed(2)} ${yScale(segment.from.y).toFixed(2)} L${xScale(segment.to.x).toFixed(2)} ${yScale(segment.to.y).toFixed(2)}`)
    .join(' ');
  const xTicks = ticks(model.view.x[0], model.view.x[1], 10);
  const yTicks = ticks(model.view.y[0], model.view.y[1], 8);
  const clipId = 'viz-snapshot-clip';
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}"/></clipPath></defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="#fbfcfc"/>`);
  parts.push(`<g stroke="#e8ecec" stroke-width="1">`);
  for (const tick of xTicks) {
    const x = xScale(tick).toFixed(2);
    parts.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}"/>`);
  }
  for (const tick of yTicks) {
    const y = yScale(tick).toFixed(2);
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}"/>`);
  }
  parts.push('</g>');
  parts.push(`<g stroke="#65717e" stroke-width="1.2">`);
  if (model.view.y[0] <= 0 && model.view.y[1] >= 0) {
    const y = yScale(0).toFixed(2);
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}"/>`);
  }
  if (model.view.x[0] <= 0 && model.view.x[1] >= 0) {
    const x = xScale(0).toFixed(2);
    parts.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}"/>`);
  }
  parts.push('</g>');
  if (options.showLabels !== false) {
    parts.push(`<g font-family="sans-serif" font-size="10" fill="#6f7b88">`);
    for (const tick of xTicks) {
      parts.push(`<text x="${xScale(tick).toFixed(2)}" y="${margin.top + plotHeight + 17}" text-anchor="middle">${escapeXml(tickLabel(tick))}</text>`);
    }
    for (const tick of yTicks) {
      parts.push(`<text x="${margin.left - 8}" y="${(yScale(tick) + 4).toFixed(2)}" text-anchor="end">${escapeXml(tickLabel(tick))}</text>`);
    }
    parts.push('</g>');
  }
  parts.push(`<g clip-path="url(#${clipId})">`);
  for (const region of model.regions) {
    const path = regionPath(region);
    if (path) parts.push(`<path d="${path}" fill="rgba(64,158,255,0.14)" stroke="none"/>`);
  }
  for (const curve of model.curves) {
    const path = curvePath(curve);
    if (!path) continue;
    const dash = curve.role === 'reference' ? ' stroke-dasharray="5 5"' : '';
    parts.push(`<path d="${path}" fill="none" stroke="${ROLE_COLORS[curve.role]}" stroke-width="${curve.role === 'primary' ? 2 : 1.7}"${dash}/>`);
  }
  if (conicPath) parts.push(`<path d="${conicPath}" fill="none" stroke="${ROLE_COLORS.primary}" stroke-width="2"/>`);
  parts.push('</g>');
  parts.push(`<g fill="#15202b">`);
  for (const point of model.points) {
    parts.push(`<circle cx="${xScale(point.x).toFixed(2)}" cy="${yScale(point.y).toFixed(2)}" r="3.5"/>`);
    if (options.showLabels !== false && point.label) {
      parts.push(`<text x="${(xScale(point.x) + 6).toFixed(2)}" y="${(yScale(point.y) - 6).toFixed(2)}" font-family="sans-serif" font-size="10" fill="#15202b">${escapeXml(point.label)}</text>`);
    }
  }
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('');
}
