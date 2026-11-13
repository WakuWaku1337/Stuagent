import { clampText, normalizeText, round, type ModeledVisualization } from './core.ts';

interface MoleculeData {
  formula: string;
  name: string;
  angle?: string;
  atoms: { symbol: string; x: number; y: number; z: number }[];
}

const MOLECULES: MoleculeData[] = [
  {
    formula: 'H2O',
    name: '水',
    angle: '104.5°',
    atoms: [
      { symbol: 'O', x: 0, y: 0, z: 0 },
      { symbol: 'H', x: 0.757, y: 0.586, z: 0 },
      { symbol: 'H', x: -0.757, y: 0.586, z: 0 },
    ],
  },
  {
    formula: 'CH4',
    name: '甲烷',
    angle: '109.5°',
    atoms: [
      { symbol: 'C', x: 0, y: 0, z: 0 },
      { symbol: 'H', x: 0.629, y: 0.629, z: 0.629 },
      { symbol: 'H', x: -0.629, y: -0.629, z: 0.629 },
      { symbol: 'H', x: -0.629, y: 0.629, z: -0.629 },
      { symbol: 'H', x: 0.629, y: -0.629, z: -0.629 },
    ],
  },
  {
    formula: 'NH3',
    name: '氨',
    angle: '107°',
    atoms: [
      { symbol: 'N', x: 0, y: 0, z: 0.12 },
      { symbol: 'H', x: 0.94, y: 0, z: -0.28 },
      { symbol: 'H', x: -0.47, y: 0.814, z: -0.28 },
      { symbol: 'H', x: -0.47, y: -0.814, z: -0.28 },
    ],
  },
  {
    formula: 'CO2',
    name: '二氧化碳',
    angle: '180°',
    atoms: [
      { symbol: 'O', x: -1.16, y: 0, z: 0 },
      { symbol: 'C', x: 0, y: 0, z: 0 },
      { symbol: 'O', x: 1.16, y: 0, z: 0 },
    ],
  },
  {
    formula: 'C2H4',
    name: '乙烯',
    angle: '120°',
    atoms: [
      { symbol: 'C', x: -0.67, y: 0, z: 0 },
      { symbol: 'C', x: 0.67, y: 0, z: 0 },
      { symbol: 'H', x: -1.24, y: 0.93, z: 0 },
      { symbol: 'H', x: -1.24, y: -0.93, z: 0 },
      { symbol: 'H', x: 1.24, y: 0.93, z: 0 },
      { symbol: 'H', x: 1.24, y: -0.93, z: 0 },
    ],
  },
  {
    formula: 'C2H2',
    name: '乙炔',
    angle: '180°',
    atoms: [
      { symbol: 'C', x: -0.6, y: 0, z: 0 },
      { symbol: 'C', x: 0.6, y: 0, z: 0 },
      { symbol: 'H', x: -1.66, y: 0, z: 0 },
      { symbol: 'H', x: 1.66, y: 0, z: 0 },
    ],
  },
  {
    formula: 'C6H6',
    name: '苯',
    angle: '120°',
    atoms: Array.from({ length: 6 }, (_, index) => {
      const angle = (index * Math.PI) / 3;
      return { symbol: 'C', x: round(1.4 * Math.cos(angle)), y: round(1.4 * Math.sin(angle)), z: 0 };
    }).concat(
      Array.from({ length: 6 }, (_, index) => {
        const angle = (index * Math.PI) / 3;
        return { symbol: 'H', x: round(2.5 * Math.cos(angle)), y: round(2.5 * Math.sin(angle)), z: 0 };
      }),
    ),
  },
  {
    formula: 'SO2',
    name: '二氧化硫',
    angle: '119°',
    atoms: [
      { symbol: 'S', x: 0, y: 0, z: 0 },
      { symbol: 'O', x: -1.2, y: 0.7, z: 0 },
      { symbol: 'O', x: 1.2, y: 0.7, z: 0 },
    ],
  },
  {
    formula: 'BF3',
    name: '三氟化硼',
    angle: '120°',
    atoms: [
      { symbol: 'B', x: 0, y: 0, z: 0 },
      { symbol: 'F', x: 1.3, y: 0, z: 0 },
      { symbol: 'F', x: -0.65, y: 1.126, z: 0 },
      { symbol: 'F', x: -0.65, y: -1.126, z: 0 },
    ],
  },
  {
    formula: 'PCl5',
    name: '五氯化磷',
    angle: '90°/120°',
    atoms: [
      { symbol: 'P', x: 0, y: 0, z: 0 },
      { symbol: 'Cl', x: 0, y: 0, z: 1.9 },
      { symbol: 'Cl', x: 0, y: 0, z: -1.9 },
      { symbol: 'Cl', x: 1.9, y: 0, z: 0 },
      { symbol: 'Cl', x: -0.95, y: 1.645, z: 0 },
      { symbol: 'Cl', x: -0.95, y: -1.645, z: 0 },
    ],
  },
  {
    formula: 'HCl',
    name: '氯化氢',
    atoms: [
      { symbol: 'H', x: -0.64, y: 0, z: 0 },
      { symbol: 'Cl', x: 0.64, y: 0, z: 0 },
    ],
  },
  {
    formula: 'O2',
    name: '氧气',
    atoms: [
      { symbol: 'O', x: -0.6, y: 0, z: 0 },
      { symbol: 'O', x: 0.6, y: 0, z: 0 },
    ],
  },
  {
    formula: 'N2',
    name: '氮气',
    atoms: [
      { symbol: 'N', x: -0.55, y: 0, z: 0 },
      { symbol: 'N', x: 0.55, y: 0, z: 0 },
    ],
  },
];

function xyzData(molecule: MoleculeData): string {
  const lines = [`${molecule.atoms.length}`, molecule.name];
  for (const atom of molecule.atoms) lines.push(`${atom.symbol} ${atom.x} ${atom.y} ${atom.z}`);
  return `${lines.join('\n')}\n`;
}

function modelMolecule(question: string): ModeledVisualization | null {
  const text = normalizeText(question).toLowerCase();
  const formulaMatch = normalizeText(question).match(/\b([A-Z][a-z]?\d*){2,}\b/);
  const formula = formulaMatch?.[0]?.replace(/[^A-Za-z0-9]/g, '') ?? '';
  const molecule = MOLECULES.find(
    (item) =>
      text.includes(item.formula.toLowerCase()) ||
      text.includes(item.name) ||
      (formula && formula.toLowerCase() === item.formula.toLowerCase()),
  );
  if (!molecule) {
    if (/氯化钠|nacl|晶体/.test(text)) return modelCrystal(question);
    return null;
  }
  return {
    type: 'molecule',
    title: clampText(`${molecule.name} ${molecule.formula}${molecule.angle ? `（键角 ${molecule.angle}）` : ''}`),
    spec: { format: 'xyz', style: 'stick', data: xyzData(molecule) },
    basis: `识别到分子 ${molecule.formula}`,
  };
}

function modelCrystal(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  if (!/氯化钠|nacl|晶体/.test(text)) return null;
  const points: { id: string; coord: [number, number, number] }[] = [];
  const edges: [string, string][] = [];
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let z = 0; z < 3; z += 1) {
        points.push({ id: `${x}${y}${z}`, coord: [x, y, z] });
      }
    }
  }
  for (const point of points) {
    const [x, y, z] = point.coord;
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]) {
      const target = `${x + dx}${y + dy}${z + dz}`;
      if (points.some((item) => item.id === target)) edges.push([point.id, target]);
    }
  }
  return {
    type: 'geometry3d',
    title: '氯化钠晶体结构',
    spec: { points, edges, faces: [], auxiliary: [], labels: false },
    basis: '识别到氯化钠晶体',
  };
}

export { modelMolecule };
