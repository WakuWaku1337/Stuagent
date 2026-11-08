import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { deleteLegacyCourseware, getLegacyCourseware, listLegacyCourseware } from '../courseware/legacy.ts';

export const VISUALIZATION_TYPES = [
  'geometry3d',
  'function2d',
  'function3d',
  'conic',
  'molecule',
  'terrain',
  'biology',
  'physics',
  'diagram',
] as const;

export type VisualizationType = (typeof VISUALIZATION_TYPES)[number];

export interface Visualization {
  visualization_id: string;
  type: VisualizationType;
  title: string;
  spec: Record<string, unknown>;
  source: string | null;
  created_at: number;
}

interface VisualizationRow {
  visualization_id: string;
  type: VisualizationType;
  title: string;
  spec: string;
  source: string | null;
  created_at: number;
}

export class VisualizationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'VisualizationError';
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateExpression(value: unknown): string {
  const expression = typeof value === 'string' ? value.trim() : '';
  if (!expression || expression.length > 300) {
    throw new VisualizationError('VIZ_EXPRESSION_INVALID', '函数表达式不能为空且不超过 300 字');
  }
  return expression;
}

function validateRange(spec: Record<string, unknown>) {
  const range = spec.range;
  if (!Array.isArray(range) || range.length !== 2 || !finiteNumber(range[0]) || !finiteNumber(range[1]) || range[0] >= range[1]) {
    throw new VisualizationError('VIZ_RANGE_INVALID', 'range 必须是 [min, max] 且 min < max');
  }
  if (Math.abs(range[0]) > 1e6 || Math.abs(range[1]) > 1e6) {
    throw new VisualizationError('VIZ_RANGE_INVALID', 'range 超出允许范围');
  }
}

function optionalString(spec: Record<string, unknown>, key: string, code: string, max = 120) {
  const value = spec[key];
  if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
    throw new VisualizationError(code, `${key} 必须是不超过 ${max} 字的字符串`);
  }
}

function optionalFinite(spec: Record<string, unknown>, key: string, code: string) {
  const value = spec[key];
  if (value !== undefined && !finiteNumber(value)) {
    throw new VisualizationError(code, `${key} 必须是有限数字`);
  }
}

function validateFunctionSpec(spec: Record<string, unknown>, needRange = true) {
  const functions = spec.functions;
  if (functions !== undefined) {
    if (!Array.isArray(functions) || functions.length < 1 || functions.length > 6) {
      throw new VisualizationError('VIZ_FUNCTIONS_INVALID', 'functions 必须是 1~6 个函数对象');
    }
    for (const item of functions) {
      if (!isRecord(item)) throw new VisualizationError('VIZ_FUNCTIONS_INVALID', 'functions 每项必须是对象');
      validateExpression(item.expression);
      optionalString(item, 'color', 'VIZ_COLOR_INVALID', 40);
      optionalString(item, 'label', 'VIZ_LABEL_INVALID', 60);
    }
  } else {
    validateExpression(spec.expression);
  }
  if (needRange) validateRange(spec);
  optionalString(spec, 'variable', 'VIZ_VARIABLE_INVALID', 20);
  if (spec.implicit !== undefined && typeof spec.implicit !== 'boolean') {
    throw new VisualizationError('VIZ_IMPLICIT_INVALID', 'implicit 必须是布尔值');
  }
  const relations = spec.relations;
  if (relations !== undefined) {
    if (!Array.isArray(relations) || relations.length > 10) {
      throw new VisualizationError('VIZ_RELATIONS_INVALID', 'relations 必须是不超过 10 项的数组');
    }
    for (const item of relations) {
      if (!isRecord(item) || typeof item.kind !== 'string') {
        throw new VisualizationError('VIZ_RELATIONS_INVALID', 'relation 需要字符串 kind');
      }
      optionalString(item, 'solve', 'VIZ_RELATIONS_INVALID', 300);
    }
  }
  const regions = spec.regions;
  if (regions !== undefined) {
    if (!Array.isArray(regions) || regions.length > 10) {
      throw new VisualizationError('VIZ_REGIONS_INVALID', 'regions 必须是不超过 10 项的数组');
    }
    for (const item of regions) {
      if (!isRecord(item)) throw new VisualizationError('VIZ_REGIONS_INVALID', 'region 必须是对象');
      validateExpression(item.where);
      optionalString(item, 'fill', 'VIZ_REGIONS_INVALID', 60);
    }
  }
  const sliders = spec.sliders;
  if (sliders !== undefined) {
    if (!Array.isArray(sliders) || sliders.length > 6) {
      throw new VisualizationError('VIZ_SLIDERS_INVALID', 'sliders 必须是不超过 6 项的数组');
    }
    for (const item of sliders) {
      if (!isRecord(item) || typeof item.param !== 'string' || !item.param.trim()) {
        throw new VisualizationError('VIZ_SLIDERS_INVALID', 'slider 需要字符串 param');
      }
      if (!finiteNumber(item.min) || !finiteNumber(item.max) || item.min >= item.max) {
        throw new VisualizationError('VIZ_SLIDERS_INVALID', 'slider 需要 min < max');
      }
      optionalFinite(item, 'step', 'VIZ_SLIDERS_INVALID');
      optionalFinite(item, 'value', 'VIZ_SLIDERS_INVALID');
    }
  }
}

const AUX_KINDS = new Set(['line', 'plane', 'perpendicular', 'midline', 'parallel', 'projection', 'mark', 'hidden', 'trajectory']);

function validateAuxiliary(spec: Record<string, unknown>, ids: Set<string>) {
  const auxiliary = spec.auxiliary;
  if (auxiliary === undefined) return;
  if (!Array.isArray(auxiliary) || auxiliary.length > 50) {
    throw new VisualizationError('VIZ_AUX_INVALID', 'auxiliary 必须是不超过 50 项的数组');
  }
  for (const item of auxiliary) {
    if (!isRecord(item) || typeof item.kind !== 'string' || !AUX_KINDS.has(item.kind)) {
      throw new VisualizationError('VIZ_AUX_KIND_INVALID', `auxiliary kind 必须是 ${[...AUX_KINDS].join('/')}`);
    }
    const points = item.points;
    if (!Array.isArray(points) || points.length < 1 || points.length > 8 || !points.every((id) => ids.has(String(id)))) {
      throw new VisualizationError('VIZ_AUX_POINTS_INVALID', 'auxiliary points 必须是 1~8 个已定义 point id');
    }
    if (item.style !== undefined) {
      if (!isRecord(item.style)) throw new VisualizationError('VIZ_AUX_STYLE_INVALID', 'style 必须是对象');
      if (item.style.dash !== undefined && typeof item.style.dash !== 'boolean') {
        throw new VisualizationError('VIZ_AUX_STYLE_INVALID', 'style.dash 必须是布尔值');
      }
      optionalString(item.style, 'color', 'VIZ_AUX_STYLE_INVALID', 40);
      if (item.style.opacity !== undefined && (!finiteNumber(item.style.opacity) || item.style.opacity < 0 || item.style.opacity > 1)) {
        throw new VisualizationError('VIZ_AUX_STYLE_INVALID', 'style.opacity 必须在 0~1');
      }
    }
    optionalString(item, 'reason', 'VIZ_AUX_REASON_INVALID', 300);
  }
  if (spec.labels !== undefined && typeof spec.labels !== 'boolean') {
    throw new VisualizationError('VIZ_LABELS_INVALID', 'labels 必须是布尔值');
  }
}

function validateGeometrySpec(spec: Record<string, unknown>) {
  const points = spec.points;
  if (!Array.isArray(points) || points.length < 2 || points.length > 200) {
    throw new VisualizationError('VIZ_POINTS_INVALID', 'geometry3d 需要 2~200 个 points');
  }
  const ids = new Set<string>();
  for (const point of points) {
    if (!isRecord(point) || typeof point.id !== 'string' || !point.id.trim()) {
      throw new VisualizationError('VIZ_POINT_INVALID', '每个 point 需要字符串 id');
    }
    if (ids.has(point.id)) throw new VisualizationError('VIZ_POINT_DUPLICATE', `point id 重复：${point.id}`);
    ids.add(point.id);
    const coord = point.coord;
    if (!Array.isArray(coord) || coord.length !== 3 || !coord.every(finiteNumber)) {
      throw new VisualizationError('VIZ_COORD_INVALID', `point ${point.id} 的 coord 必须是 3 个有限数字`);
    }
    if (coord.some((value) => Math.abs(value) > 1e6)) {
      throw new VisualizationError('VIZ_COORD_INVALID', `point ${point.id} 坐标超出范围`);
    }
  }
  const edges = spec.edges;
  if (edges !== undefined) {
    if (!Array.isArray(edges) || edges.length > 500) {
      throw new VisualizationError('VIZ_EDGES_INVALID', 'edges 必须是不超过 500 条的数组');
    }
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2 || !ids.has(String(edge[0])) || !ids.has(String(edge[1]))) {
        throw new VisualizationError('VIZ_EDGE_INVALID', 'edge 必须是两个已定义 point id');
      }
    }
  }
  const faces = spec.faces;
  if (faces !== undefined) {
    if (!Array.isArray(faces) || faces.length > 200) {
      throw new VisualizationError('VIZ_FACES_INVALID', 'faces 必须是不超过 200 个数组');
    }
    for (const face of faces) {
      if (!Array.isArray(face) || face.length < 3 || !face.every((id) => ids.has(String(id)))) {
        throw new VisualizationError('VIZ_FACE_INVALID', 'face 至少需要 3 个已定义 point id');
      }
    }
  }
  validateAuxiliary(spec, ids);
}

function validateMoleculeSpec(spec: Record<string, unknown>) {
  if (spec.format !== 'xyz' && spec.format !== 'pdb' && spec.format !== 'sdf') {
    throw new VisualizationError('VIZ_MOLECULE_FORMAT', 'molecule format 必须是 xyz/pdb/sdf');
  }
  if (typeof spec.data !== 'string' || !spec.data.trim() || spec.data.length > 20000) {
    throw new VisualizationError('VIZ_MOLECULE_DATA', 'molecule data 必须是非空且不超过 20000 字的结构文本');
  }
  if (spec.style !== undefined && !['stick', 'sphere', 'line', 'cartoon'].includes(String(spec.style))) {
    throw new VisualizationError('VIZ_MOLECULE_STYLE', 'molecule style 必须是 stick/sphere/line/cartoon');
  }
}

function validateBiologySpec(spec: Record<string, unknown>) {
  const parts = spec.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 100) {
    throw new VisualizationError('VIZ_PARTS_INVALID', 'biology 需要 1~100 个 parts');
  }
  for (const part of parts) {
    if (!isRecord(part) || typeof part.id !== 'string' || typeof part.label !== 'string') {
      throw new VisualizationError('VIZ_PART_INVALID', 'part 需要字符串 id 与 label');
    }
    const coord = part.coord;
    if (!Array.isArray(coord) || coord.length !== 3 || !coord.every(finiteNumber)) {
      throw new VisualizationError('VIZ_PART_INVALID', `part ${part.id} 的 coord 必须是 3 个有限数字`);
    }
    if (!finiteNumber(part.radius) || part.radius <= 0 || part.radius > 10) {
      throw new VisualizationError('VIZ_PART_INVALID', `part ${part.id} 的 radius 必须在 0~10`);
    }
    optionalString(part, 'color', 'VIZ_PART_INVALID', 40);
  }
}

function validateTerrainSpec(spec: Record<string, unknown>) {
  const grid = spec.grid;
  if (grid !== undefined) {
    if (!Array.isArray(grid) || grid.length < 2 || grid.length > 64) {
      throw new VisualizationError('VIZ_GRID_INVALID', 'terrain grid 必须是 2~64 行');
    }
    for (const row of grid) {
      if (!Array.isArray(row) || row.length < 2 || row.length > 64 || !row.every(finiteNumber)) {
        throw new VisualizationError('VIZ_GRID_INVALID', 'terrain grid 每行必须是 2~64 个有限数字');
      }
    }
    return;
  }
  validateExpression(spec.expression);
  validateRange(spec);
}

const SHAPE_KINDS = new Set(['rect', 'arrow', 'text', 'line', 'circle']);

function validateShapeSpec(spec: Record<string, unknown>) {
  const elements = spec.elements;
  if (!Array.isArray(elements) || elements.length < 1 || elements.length > 100) {
    throw new VisualizationError('VIZ_ELEMENTS_INVALID', 'physics/diagram 需要 1~100 个 elements');
  }
  for (const element of elements) {
    if (!isRecord(element) || typeof element.kind !== 'string' || !SHAPE_KINDS.has(element.kind)) {
      throw new VisualizationError('VIZ_ELEMENT_INVALID', `element kind 必须是 ${[...SHAPE_KINDS].join('/')}`);
    }
    for (const key of ['x', 'y', 'w', 'h', 'r', 'rotate']) optionalFinite(element, key, 'VIZ_ELEMENT_INVALID');
    for (const key of ['from', 'to']) {
      const value = element[key];
      if (value !== undefined && (!Array.isArray(value) || value.length !== 2 || !value.every(finiteNumber))) {
        throw new VisualizationError('VIZ_ELEMENT_INVALID', `element ${key} 必须是 2 个有限数字`);
      }
    }
    optionalString(element, 'label', 'VIZ_ELEMENT_INVALID');
    optionalString(element, 'text', 'VIZ_ELEMENT_INVALID');
    optionalString(element, 'color', 'VIZ_ELEMENT_INVALID', 40);
  }
}

export function validateVisualizationSpec(type: VisualizationType, raw: unknown): Record<string, unknown> {
  if (!VISUALIZATION_TYPES.includes(type)) {
    throw new VisualizationError('VIZ_TYPE_INVALID', `不支持的可视化类型：${type}`);
  }
  if (!isRecord(raw)) throw new VisualizationError('VIZ_SPEC_INVALID', 'spec 必须是对象');
  const spec = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (JSON.stringify(spec).length > 20000) {
    throw new VisualizationError('VIZ_SPEC_TOO_LARGE', 'spec 不能超过 20000 字符');
  }
  if (type === 'geometry3d') {
    validateGeometrySpec(spec);
  } else if (type === 'function2d' || type === 'conic' || type === 'function3d') {
    validateFunctionSpec(spec, true);
  } else if (type === 'molecule') {
    validateMoleculeSpec(spec);
  } else if (type === 'biology') {
    validateBiologySpec(spec);
  } else if (type === 'terrain') {
    validateTerrainSpec(spec);
  } else if (type === 'physics' || type === 'diagram') {
    validateShapeSpec(spec);
  }
  return spec;
}

function toVisualization(row: VisualizationRow): Visualization {
  return {
    visualization_id: row.visualization_id,
    type: row.type,
    title: row.title,
    spec: JSON.parse(row.spec) as Record<string, unknown>,
    source: row.source,
    created_at: row.created_at,
  };
}

export function listVisualizations(type?: VisualizationType): Visualization[] {
  if (type) {
    return (
      db.prepare('SELECT * FROM visualizations WHERE type = ? ORDER BY created_at DESC LIMIT 50').all(type) as unknown as VisualizationRow[]
    ).map(toVisualization);
  }
  return (
    db.prepare('SELECT * FROM visualizations ORDER BY created_at DESC LIMIT 50').all() as unknown as VisualizationRow[]
  ).map(toVisualization);
}

export function getVisualization(id: string): Visualization | undefined {
  const row = db.prepare('SELECT * FROM visualizations WHERE visualization_id = ?').get(id) as unknown as
    | VisualizationRow
    | undefined;
  return row ? toVisualization(row) : undefined;
}

export function createVisualization(input: {
  type: VisualizationType;
  title: string;
  spec: unknown;
  source?: string;
  visualizationId?: string;
}): Visualization {
  const type = input.type;
  const title = input.title?.trim() ?? '';
  if (!title || title.length > 80) {
    throw new VisualizationError('VIZ_TITLE_INVALID', '标题不能为空且不超过 80 字');
  }
  const spec = validateVisualizationSpec(type, input.spec);
  if (input.visualizationId) {
    const existing = getVisualization(input.visualizationId);
    if (existing) return existing;
  }
  const id = input.visualizationId ?? randomUUID();
  db.prepare(
    `INSERT INTO visualizations (visualization_id, type, title, spec, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, type, title, JSON.stringify(spec), input.source ?? null, Date.now());
  return getVisualization(id)!;
}

export function deleteVisualization(id: string): boolean {
  return db.prepare('DELETE FROM visualizations WHERE visualization_id = ?').run(id).changes > 0;
}

export interface UnifiedVisualization extends Omit<Visualization, 'type'> {
  type: VisualizationType | 'legacy-html';
  kind: 'preset' | 'generated' | 'legacy';
  html_url?: string;
}

function toUnified(row: VisualizationRow): UnifiedVisualization {
  const base = toVisualization(row);
  return { ...base, kind: row.source === 'preset' ? 'preset' : 'generated' };
}

export function listUnifiedVisualizations(type?: VisualizationType): UnifiedVisualization[] {
  const items = listVisualizations(type).map((item) => ({
    ...item,
    kind: (item.source === 'preset' ? 'preset' : 'generated') as 'preset' | 'generated',
  }));
  if (type) return items;
  const legacy = listLegacyCourseware().map((row) => ({
    visualization_id: row.courseware_id,
    type: 'legacy-html' as const,
    title: row.title,
    spec: { topic: row.topic, subject: row.subject },
    source: row.source,
    created_at: row.created_at,
    kind: 'legacy' as const,
    html_url: `/api/courseware/${row.courseware_id}`,
  }));
  return [...items, ...legacy].sort((a, b) => b.created_at - a.created_at).slice(0, 80);
}

export function getUnifiedVisualization(id: string): UnifiedVisualization | undefined {
  const row = db.prepare('SELECT * FROM visualizations WHERE visualization_id = ?').get(id) as unknown as
    | VisualizationRow
    | undefined;
  if (row) return toUnified(row);
  const legacy = getLegacyCourseware(id);
  if (!legacy) return undefined;
  return {
    visualization_id: legacy.courseware_id,
    type: 'legacy-html',
    title: legacy.title,
    spec: { topic: legacy.topic, subject: legacy.subject },
    source: legacy.source,
    created_at: legacy.created_at,
    kind: 'legacy',
    html_url: `/api/courseware/${legacy.courseware_id}`,
  };
}

export function deleteUnifiedVisualization(id: string): boolean {
  return deleteVisualization(id) || deleteLegacyCourseware(id);
}
