import type { Visualization } from '../api/visualize';

export function typeLabel(type: string): string {
  return (
    {
      geometry3d: '立体几何',
      function2d: '函数图像',
      function3d: '三维函数',
      conic: '圆锥曲线',
      molecule: '化学分子',
      terrain: '地理地形',
      biology: '生物结构',
      physics: '物理图示',
      diagram: '通用示意图',
      'legacy-html': '旧版课件',
    }[type] ?? type
  );
}

export type VizSpec = Record<string, unknown>;

export interface GeometryPoint {
  id: string;
  coord: [number, number, number];
}

export interface GeometryView {
  points: GeometryPoint[];
  edges: [string, string][];
  faces: string[][];
}

export function geometryOf(spec: VizSpec): GeometryView {
  const rawPoints = Array.isArray(spec.points) ? spec.points : [];
  const points = rawPoints
    .filter((point): point is Record<string, unknown> => Boolean(point) && typeof point === 'object')
    .map((point) => ({
      id: String(point.id ?? ''),
      coord: (Array.isArray(point.coord) ? point.coord.slice(0, 3) : [0, 0, 0]).map(Number) as [number, number, number],
    }))
    .filter((point) => point.id && point.coord.every(Number.isFinite));
  const ids = new Set(points.map((point) => point.id));
  const edges = (Array.isArray(spec.edges) ? spec.edges : [])
    .filter((edge): edge is unknown[] => Array.isArray(edge) && edge.length === 2)
    .map((edge) => [String(edge[0]), String(edge[1])] as [string, string])
    .filter(([a, b]) => ids.has(a) && ids.has(b));
  const faces = (Array.isArray(spec.faces) ? spec.faces : [])
    .filter((face): face is unknown[] => Array.isArray(face) && face.length >= 3)
    .map((face) => face.map(String))
    .filter((face) => face.every((id) => ids.has(id)));
  return { points, edges, faces };
}

export function visualizationOf(item: Visualization): Visualization {
  return item;
}
