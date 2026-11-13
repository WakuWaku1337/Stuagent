import { clampText, normalizeText, round, type ModeledVisualization } from './core.ts';

interface PointMap {
  points: { id: string; coord: [number, number, number] }[];
  ids: Set<string>;
}

function addPoint(map: PointMap, id: string, coord: [number, number, number]): void {
  if (!id || map.ids.has(id)) return;
  map.ids.add(id);
  map.points.push({ id, coord: coord.map((value) => round(value)) as [number, number, number] });
}

function pointOf(map: PointMap, id: string): [number, number, number] | null {
  const point = map.points.find((item) => item.id === id);
  return point ? point.coord : null;
}

function parseMidpoints(text: string, map: PointMap): void {
  const re = /([A-Z](?:\d)?)\s*(?:为|是|取)\s*(?:棱)?\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)\s*(?:的)?中点/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const a = pointOf(map, match[2]);
    const b = pointOf(map, match[3]);
    if (a && b) addPoint(map, match[1], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  }
}

function parseRatioPoints(text: string, map: PointMap): void {
  const re = /([A-Z](?:\d)?)\s*(?:在|为)\s*(?:棱)?\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)\s*上[^。;]*?([A-Z](?:\d)?)\s*:\s*([A-Z](?:\d)?)\s*=\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const a = pointOf(map, match[2]);
    const b = pointOf(map, match[3]);
    const p = match[4];
    const q = match[5];
    const n1 = Number(match[6]);
    const n2 = Number(match[7]);
    if (!a || !b || !Number.isFinite(n1) || !Number.isFinite(n2) || n1 + n2 === 0) continue;
    const start = p === match[2] || p === q ? a : b;
    const end = p === match[2] || p === q ? b : a;
    const t = n1 / (n1 + n2);
    addPoint(map, match[1], [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
      start[2] + (end[2] - start[2]) * t,
    ]);
  }
}

function collectLinePairs(text: string, map: PointMap): [string, string][] {
  const pairs: [string, string][] = [];
  const add = (a: string, b: string) => {
    if (a !== b && pointOf(map, a) && pointOf(map, b)) pairs.push([a, b]);
  };
  for (const match of text.matchAll(/体对角线\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)/g)) add(match[1], match[2]);
  for (const match of text.matchAll(/(?:直线|线段|连接|连)\s*([A-Z](?:\d)?)\s*([A-Z](?:\d)?)/g)) add(match[1], match[2]);
  return pairs;
}

function parseSectionPoints(text: string): string[] {
  const matches = [
    ...text.matchAll(/(?:过|经过)\s*([A-Z](?:\d)?(?:\s*[、,和与]\s*[A-Z](?:\d)?){2,})\s*(?:三点|的截面|的平面|截面)?/g),
    ...text.matchAll(/截面\s*([A-Z](?:\d)?(?:\s*[、,和与]?\s*[A-Z](?:\d)?){2,})/g),
  ];
  for (const match of matches) {
    const ids = match[1].match(/[A-Z](?:\d)?/g) ?? [];
    const unique = [...new Set(ids)];
    if (unique.length >= 3) return unique;
  }
  return [];
}

function cubeSpec(question: string): ModeledVisualization | null {
  if (!/正方体|立方体|长方体|棱长/.test(question)) return null;
  const text = normalizeText(question);
  const sideMatch = text.match(/(?:棱长|边长)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const side = sideMatch ? Number(sideMatch[1]) : 1;
  const topMatch = text.match(/ABCD\s*-\s*([A-Z])([A-Z])([A-Z])([A-Z])/);
  const topIds = topMatch ? [topMatch[1], topMatch[2], topMatch[3], topMatch[4]] : ['A1', 'B1', 'C1', 'D1'];
  const bottomIds = ['A', 'B', 'C', 'D'];
  const map: PointMap = { points: [], ids: new Set() };
  const coords: [number, number, number][] = [
    [0, 0, 0],
    [side, 0, 0],
    [side, side, 0],
    [0, side, 0],
  ];
  bottomIds.forEach((id, index) => addPoint(map, id, coords[index]));
  topIds.forEach((id, index) => addPoint(map, id, [coords[index][0], coords[index][1], side]));
  parseMidpoints(text, map);
  parseRatioPoints(text, map);

  const edges: [string, string][] = [];
  const link = (a: string, b: string) => {
    if (pointOf(map, a) && pointOf(map, b)) edges.push([a, b]);
  };
  for (let i = 0; i < 4; i += 1) {
    link(bottomIds[i], bottomIds[(i + 1) % 4]);
    link(topIds[i], topIds[(i + 1) % 4]);
    link(bottomIds[i], topIds[i]);
  }
  const faces = [
    bottomIds,
    [...topIds].reverse(),
    [bottomIds[0], bottomIds[1], topIds[1], topIds[0]],
    [bottomIds[1], bottomIds[2], topIds[2], topIds[1]],
    [bottomIds[2], bottomIds[3], topIds[3], topIds[2]],
    [bottomIds[3], bottomIds[0], topIds[0], topIds[3]],
  ];
  const auxiliary: Record<string, unknown>[] = [];
  const section = parseSectionPoints(text).filter((id) => pointOf(map, id));
  if (section.length >= 3) {
    auxiliary.push({
      kind: 'plane',
      points: section,
      style: { color: '#f56c6c', opacity: 0.35 },
      reason: `过 ${section.join('、')} 的截面`,
    });
  }
  for (const [a, b] of collectLinePairs(text, map)) {
    auxiliary.push({ kind: 'line', points: [a, b], style: { color: '#e6a23c' }, reason: `线段 ${a}${b}` });
  }
  return {
    type: 'geometry3d',
    title: clampText(`正方体 ${bottomIds.join('')}-${topIds.join('')}（棱长 ${side}）`),
    spec: { points: map.points, edges, faces, auxiliary, labels: true },
    basis: `解析到正方体棱长 ${side}，${map.points.length} 个点`,
  };
}

function pyramidSpec(question: string): ModeledVisualization | null {
  if (!/棱锥/.test(question)) return null;
  const text = normalizeText(question);
  const match = text.match(/([A-Z])\s*-\s*([A-Z]{3,4})/);
  if (!match) return null;
  const apex = match[1];
  const baseIds = match[2].split('');
  if (baseIds.length < 3 || baseIds.length > 4) return null;
  const sideMatch = text.match(/(?:底面边长|边长|棱长)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const heightMatch = text.match(/高(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const side = sideMatch ? Number(sideMatch[1]) : 2;
  const height = heightMatch ? Number(heightMatch[1]) : side;
  const map: PointMap = { points: [], ids: new Set() };
  if (baseIds.length === 4) {
    const half = side / 2;
    addPoint(map, baseIds[0], [-half, -half, 0]);
    addPoint(map, baseIds[1], [half, -half, 0]);
    addPoint(map, baseIds[2], [half, half, 0]);
    addPoint(map, baseIds[3], [-half, half, 0]);
  } else {
    const radius = side / Math.sqrt(3);
    for (let index = 0; index < 3; index += 1) {
      const angle = Math.PI / 2 + (index * 2 * Math.PI) / 3;
      addPoint(map, baseIds[index], [round(radius * Math.cos(angle)), round(radius * Math.sin(angle)), 0]);
    }
  }
  addPoint(map, apex, [0, 0, height]);
  addPoint(map, 'O', [0, 0, 0]);
  parseMidpoints(text, map);
  parseRatioPoints(text, map);
  const edges: [string, string][] = [];
  for (let index = 0; index < baseIds.length; index += 1) {
    edges.push([baseIds[index], baseIds[(index + 1) % baseIds.length]]);
    edges.push([apex, baseIds[index]]);
  }
  const faces = [
    baseIds,
    ...baseIds.map((id, index) => [apex, id, baseIds[(index + 1) % baseIds.length]]),
  ];
  const auxiliary: Record<string, unknown>[] = [];
  if (/高|体积|线面角|二面角/.test(text)) {
    auxiliary.push({ kind: 'perpendicular', points: [apex, 'O'], style: { dash: true, color: '#e6a23c' }, reason: `${apex}O 为棱锥的高` });
  }
  return {
    type: 'geometry3d',
    title: clampText(`棱锥 ${apex}-${baseIds.join('')}（底边 ${side}，高 ${height}）`),
    spec: { points: map.points, edges, faces, auxiliary, labels: true },
    basis: `解析到棱锥 ${apex}-${baseIds.join('')}，底边 ${side}，高 ${height}`,
  };
}

function roundBodySpec(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  const isCylinder = /圆柱/.test(text);
  const isCone = /圆锥/.test(text);
  const isSphere = /球/.test(text) && !/球体运动|球赛/.test(text);
  if (!isCylinder && !isCone && !isSphere) return null;
  const rMatch = text.match(/(?:半径|底面半径)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const hMatch = text.match(/高(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const r = rMatch ? Number(rMatch[1]) : 1;
  const h = hMatch ? Number(hMatch[1]) : r * 2;
  const map: PointMap = { points: [], ids: new Set() };
  const ring = (prefix: string, plane: 'xy' | 'xz' | 'yz', radius: number, offset = 0) => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index * Math.PI * 2) / 12;
      const id = `${prefix}${index}`;
      const coord: [number, number, number] =
        plane === 'xy'
          ? [round(radius * Math.cos(angle)), round(radius * Math.sin(angle)), offset]
          : plane === 'xz'
            ? [round(radius * Math.cos(angle)), offset, round(radius * Math.sin(angle))]
            : [offset, round(radius * Math.cos(angle)), round(radius * Math.sin(angle))];
      addPoint(map, id, coord);
      ids.push(id);
    }
    return ids;
  };
  const edges: [string, string][] = [];
  if (isSphere) {
    const rings = [ring('a', 'xy', r), ring('b', 'xz', r), ring('c', 'yz', r)];
    for (const ids of rings) {
      for (let index = 0; index < ids.length; index += 1) edges.push([ids[index], ids[(index + 1) % ids.length]]);
    }
    return {
      type: 'geometry3d',
      title: clampText(`球（半径 ${r}）`),
      spec: { points: map.points, edges, faces: [], auxiliary: [], labels: false },
      basis: `解析到球半径 ${r}`,
    };
  }
  if (isCylinder) {
    const bottom = ring('b', 'xy', r, 0);
    const top = ring('t', 'xy', r, h);
    for (let index = 0; index < 12; index += 1) {
      edges.push([bottom[index], bottom[(index + 1) % 12]]);
      edges.push([top[index], top[(index + 1) % 12]]);
      edges.push([bottom[index], top[index]]);
    }
    return {
      type: 'geometry3d',
      title: clampText(`圆柱（半径 ${r}，高 ${h}）`),
      spec: { points: map.points, edges, faces: [], auxiliary: [], labels: false },
      basis: `解析到圆柱半径 ${r}、高 ${h}`,
    };
  }
  const bottom = ring('b', 'xy', r, 0);
  addPoint(map, 'P', [0, 0, h]);
  for (let index = 0; index < 12; index += 1) {
    edges.push([bottom[index], bottom[(index + 1) % 12]]);
    edges.push([bottom[index], 'P']);
  }
  const faces = bottom.map((id, index) => ['P', id, bottom[(index + 1) % 12]]);
  return {
    type: 'geometry3d',
    title: clampText(`圆锥（半径 ${r}，高 ${h}）`),
    spec: { points: map.points, edges, faces, auxiliary: [], labels: false },
    basis: `解析到圆锥半径 ${r}、高 ${h}`,
  };
}

function modelGeometry(question: string): ModeledVisualization | null {
  return cubeSpec(question) ?? pyramidSpec(question) ?? roundBodySpec(question);
}

export { modelGeometry };
