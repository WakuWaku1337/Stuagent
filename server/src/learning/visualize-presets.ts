import type { VisualizationType } from './visualize.ts';

export interface VizPreset {
  id: string;
  title: string;
  subject: string;
  type: VisualizationType;
  keywords: string[];
  spec: Record<string, unknown>;
}

const CUBE_POINTS = [
  { id: 'A', coord: [0, 0, 0] },
  { id: 'B', coord: [1, 0, 0] },
  { id: 'C', coord: [1, 1, 0] },
  { id: 'D', coord: [0, 1, 0] },
  { id: 'E', coord: [0, 0, 1] },
  { id: 'F', coord: [1, 0, 1] },
  { id: 'G', coord: [1, 1, 1] },
  { id: 'H', coord: [0, 1, 1] },
];

const CUBE_EDGES: [string, string][] = [
  ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'],
  ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'E'],
  ['A', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H'],
];

export const VIZ_PRESETS: VizPreset[] = [
  {
    id: 'cube-section',
    title: '正方体与截面',
    subject: '数学',
    type: 'geometry3d',
    keywords: ['正方体', '立方体', '截面', '长方体'],
    spec: {
      points: CUBE_POINTS,
      edges: CUBE_EDGES,
      faces: [['A', 'B', 'C', 'D'], ['E', 'F', 'G', 'H'], ['A', 'B', 'F', 'E'], ['B', 'C', 'G', 'F'], ['C', 'D', 'H', 'G'], ['D', 'A', 'E', 'H']],
      auxiliary: [
        { kind: 'plane', points: ['A', 'C', 'F'], style: { color: '#f56c6c', opacity: 0.35 }, reason: '过 A、C、F 三点的截面，用于观察截面形状' },
        { kind: 'line', points: ['A', 'G'], style: { dash: true }, reason: '体对角线 AG，常用于求线面角' },
      ],
      labels: true,
    },
  },
  {
    id: 'pyramid',
    title: '四棱锥与高',
    subject: '数学',
    type: 'geometry3d',
    keywords: ['棱锥', '四棱锥', '三棱锥', '棱柱'],
    spec: {
      points: [
        { id: 'A', coord: [0, 0, 0] },
        { id: 'B', coord: [1, 0, 0] },
        { id: 'C', coord: [1, 1, 0] },
        { id: 'D', coord: [0, 1, 0] },
        { id: 'P', coord: [0.5, 0.5, 1.2] },
        { id: 'O', coord: [0.5, 0.5, 0] },
      ],
      edges: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'], ['P', 'A'], ['P', 'B'], ['P', 'C'], ['P', 'D']],
      faces: [['A', 'B', 'C', 'D'], ['P', 'A', 'B'], ['P', 'B', 'C'], ['P', 'C', 'D'], ['P', 'D', 'A']],
      auxiliary: [
        { kind: 'perpendicular', points: ['P', 'O'], style: { dash: true, color: '#e6a23c' }, reason: 'PO 为棱锥的高，垂足 O 是底面中心' },
      ],
      labels: true,
    },
  },
  {
    id: 'pythagoras',
    title: '勾股定理的面积证法',
    subject: '数学',
    type: 'geometry3d',
    keywords: ['勾股', '直角三角形', '毕达哥拉斯'],
    spec: {
      points: [
        { id: 'C', coord: [0, 0, 0] },
        { id: 'A', coord: [3, 0, 0] },
        { id: 'B', coord: [3, 4, 0] },
        { id: 'A1', coord: [3, -3, 0] },
        { id: 'C1', coord: [0, -3, 0] },
        { id: 'B1', coord: [7, 4, 0] },
        { id: 'B2', coord: [7, 0, 0] },
      ],
      edges: [['C', 'A'], ['A', 'B'], ['C', 'B'], ['A', 'A1'], ['A1', 'C1'], ['C1', 'C'], ['B', 'B1'], ['B1', 'B2'], ['B2', 'A']],
      faces: [['C', 'A', 'B'], ['A', 'A1', 'C1', 'C'], ['A', 'B', 'B1', 'B2']],
      auxiliary: [
        { kind: 'mark', points: ['A'], reason: '直角符号：∠CAB 的补角处为直角标记位' },
      ],
      labels: true,
    },
  },
  {
    id: 'quad-intersection',
    title: '二次函数与直线的交点',
    subject: '数学',
    type: 'function2d',
    keywords: ['二次函数', '抛物线', '交点', '数形结合', '不等式'],
    spec: {
      functions: [
        { expression: 'x^2', color: '#409eff', label: 'y=x²' },
        { expression: 'x+2', color: '#f56c6c', label: 'y=x+2' },
      ],
      range: [-3, 4],
      relations: [{ kind: 'intersection', solve: 'x^2=x+2' }],
      regions: [{ where: 'x^2 < x+2', fill: 'rgba(64,158,255,0.2)' }],
      sliders: [],
    },
  },
  {
    id: 'sine-wave',
    title: '正弦函数图像',
    subject: '数学',
    type: 'function2d',
    keywords: ['正弦', '三角函数', 'sin', '余弦', '周期'],
    spec: {
      functions: [{ expression: 'sin(x)', color: '#409eff', label: 'y=sin x' }],
      range: [-6.283, 6.283],
      relations: [],
      regions: [],
      sliders: [{ param: 'a', min: 0.5, max: 3, step: 0.1, value: 1 }],
    },
  },
  {
    id: 'ellipse',
    title: '椭圆的标准方程',
    subject: '数学',
    type: 'conic',
    keywords: ['椭圆', '双曲线', '圆锥曲线', '离心率'],
    spec: {
      expression: 'x^2/9 + y^2/4 - 1',
      implicit: true,
      range: [-4, 4],
    },
  },
  {
    id: 'water-molecule',
    title: '水分子的空间构型',
    subject: '化学',
    type: 'molecule',
    keywords: ['水分子', 'H2O', '水', '键角', '分子构型'],
    spec: {
      format: 'xyz',
      style: 'stick',
      data: '3\nwater\nO 0.000 0.000 0.000\nH 0.757 0.586 0.000\nH -0.757 0.586 0.000\n',
    },
  },
  {
    id: 'methane',
    title: '甲烷的正四面体构型',
    subject: '化学',
    type: 'molecule',
    keywords: ['甲烷', 'CH4', '正四面体', '共价键'],
    spec: {
      format: 'xyz',
      style: 'stick',
      data: '5\nmethane\nC 0.000 0.000 0.000\nH 0.629 0.629 0.629\nH -0.629 -0.629 0.629\nH -0.629 0.629 -0.629\nH 0.629 -0.629 -0.629\n',
    },
  },
  {
    id: 'incline-forces',
    title: '斜面上物体的受力分析',
    subject: '物理',
    type: 'physics',
    keywords: ['受力', '摩擦力', '斜面', '牛顿', '受力分析'],
    spec: {
      elements: [
        { kind: 'line', from: [40, 320], to: [620, 320], label: '地面' },
        { kind: 'line', from: [80, 320], to: [560, 120] },
        { kind: 'rect', x: 280, y: 190, w: 70, h: 46, label: 'm', rotate: -22.6 },
        { kind: 'arrow', from: [315, 213], to: [315, 320], label: 'G', color: '#f56c6c' },
        { kind: 'arrow', from: [315, 213], to: [272, 112], label: 'N', color: '#409eff' },
        { kind: 'arrow', from: [315, 213], to: [400, 177], label: 'f', color: '#67c23a' },
        { kind: 'text', x: 470, y: 300, text: '沿斜面方向分解 G' },
      ],
    },
  },
  {
    id: 'ohm-circuit',
    title: '欧姆定律简单电路',
    subject: '物理',
    type: 'physics',
    keywords: ['电路', '欧姆', '电阻', '电流', '电压'],
    spec: {
      elements: [
        { kind: 'line', from: [120, 100], to: [520, 100] },
        { kind: 'line', from: [520, 100], to: [520, 300] },
        { kind: 'line', from: [520, 300], to: [120, 300] },
        { kind: 'line', from: [120, 300], to: [120, 100] },
        { kind: 'rect', x: 280, y: 84, w: 80, h: 32, label: 'R' },
        { kind: 'circle', x: 120, y: 200, r: 22, label: 'V' },
        { kind: 'text', x: 300, y: 340, text: 'I = U / R' },
        { kind: 'arrow', from: [200, 100], to: [260, 100], label: 'I', color: '#e6a23c' },
      ],
    },
  },
  {
    id: 'animal-cell',
    title: '动物细胞的主要结构',
    subject: '生物',
    type: 'biology',
    keywords: ['细胞', '细胞器', '细胞核', '线粒体'],
    spec: {
      parts: [
        { id: 'membrane', label: '细胞膜', coord: [0, 0, 0], radius: 1.6, color: '#8ec5ff' },
        { id: 'nucleus', label: '细胞核', coord: [0.2, 0.1, 0], radius: 0.6, color: '#b07ce8' },
        { id: 'mito', label: '线粒体', coord: [-0.9, -0.4, 0.3], radius: 0.3, color: '#f2a05e' },
        { id: 'ribosome', label: '核糖体', coord: [0.8, -0.7, -0.2], radius: 0.16, color: '#7fd6a4' },
      ],
    },
  },
  {
    id: 'contour-terrain',
    title: '等高线地形',
    subject: '地理',
    type: 'terrain',
    keywords: ['地形', '等高线', '山地', '海拔'],
    spec: {
      expression: 'sin(x/2)*cos(y/2)*2 + 2',
      range: [-6, 6],
    },
  },
];

export function matchPreset(question: string, subject?: string): VizPreset | undefined {
  const text = `${question} ${subject ?? ''}`.toLowerCase();
  let best: VizPreset | undefined;
  let bestScore = 0;
  for (const preset of VIZ_PRESETS) {
    let score = 0;
    for (const keyword of preset.keywords) {
      if (text.includes(keyword.toLowerCase())) score += keyword.length;
    }
    if (subject && preset.subject === subject) score += 1;
    if (score > bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : undefined;
}

export function presetById(id: string): VizPreset | undefined {
  return VIZ_PRESETS.find((preset) => preset.id === id);
}