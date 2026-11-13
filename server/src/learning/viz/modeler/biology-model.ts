import { clampText, normalizeText, type ModeledVisualization } from './core.ts';

function modelBiology(question: string): ModeledVisualization | null {
  if (!/细胞|细胞器|线粒体|叶绿体|细胞核|细胞膜/.test(question)) return null;
  const text = normalizeText(question);
  const plant = /植物细胞|叶绿体|细胞壁|液泡/.test(text);
  const organelles: { id: string; label: string; coord: [number, number, number]; radius: number; color: string }[] = [
    { id: 'membrane', label: plant ? '细胞壁 / 细胞膜' : '细胞膜', coord: [0, 0, 0], radius: 1.7, color: '#8ec5ff' },
    { id: 'nucleus', label: '细胞核', coord: [0.25, 0.1, 0], radius: 0.55, color: '#b07ce8' },
  ];
  const add = (id: string, label: string, coord: [number, number, number], radius: number, color: string) => {
    if (text.includes(label) || text.includes(label.replace('质网', '内质网'))) organelles.push({ id, label, coord, radius, color });
  };
  if (!/线粒体|核糖体|内质网|高尔基体|溶酶体|叶绿体|液泡/.test(text)) {
    organelles.push(
      { id: 'mito', label: '线粒体', coord: [-0.9, -0.4, 0.3], radius: 0.3, color: '#f2a05e' },
      { id: 'ribosome', label: '核糖体', coord: [0.85, -0.7, -0.2], radius: 0.16, color: '#7fd6a4' },
      { id: 'er', label: '内质网', coord: [-0.4, 0.8, -0.2], radius: 0.32, color: '#7aa7e8' },
      { id: 'golgi', label: '高尔基体', coord: [0.7, 0.8, 0.2], radius: 0.25, color: '#d48ac4' },
    );
  } else {
    add('mito', '线粒体', [-0.9, -0.4, 0.3], 0.3, '#f2a05e');
    add('ribosome', '核糖体', [0.85, -0.7, -0.2], 0.16, '#7fd6a4');
    add('er', '内质网', [-0.4, 0.8, -0.2], 0.32, '#7aa7e8');
    add('golgi', '高尔基体', [0.7, 0.8, 0.2], 0.25, '#d48ac4');
    add('lysosome', '溶酶体', [-1.1, 0.5, 0.2], 0.2, '#e0a24a');
    add('chloroplast', '叶绿体', [-0.2, -0.9, 0.1], 0.28, '#5cb85c');
    add('vacuole', '液泡', [0.4, -0.2, -0.3], 0.45, '#9fd3f0');
  }
  return {
    type: 'biology',
    title: clampText(plant ? '植物细胞结构' : '动物细胞结构'),
    spec: { parts: organelles },
    basis: `识别到${plant ? '植物' : '动物'}细胞，${organelles.length} 个结构`,
  };
}

export { modelBiology };
