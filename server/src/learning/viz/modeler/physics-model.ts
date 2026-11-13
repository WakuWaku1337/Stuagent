import { clampText, normalizeText, round, type ModeledVisualization } from './core.ts';

function modelPaperFeed(question: string): ModeledVisualization | null {
  if (!/打印机|进纸|搓纸|滚轮|摩擦片/.test(question)) return null;
  const text = normalizeText(question);
  const sheetMatch = [...text.matchAll(/第\s*(\d+)\s*张/g)].map((match) => Number(match[1]));
  const referenced = sheetMatch.length ? Math.max(...sheetMatch) : 0;
  const count = Math.min(6, Math.max(4, referenced));
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [80, 370], to: [640, 370] },
    { kind: 'text', x: 520, y: 392, text: '送纸方向 →' },
    { kind: 'circle', x: 360, y: 76, r: 28, label: '滚轮' },
    { kind: 'arrow', from: [360, 14], to: [360, 40], label: 'F压', color: '#e6a23c' },
  ];
  const top = 150;
  const gap = 24;
  for (let index = 0; index < count; index += 1) {
    const y = top + index * gap;
    elements.push({ kind: 'rect', x: 250, y, w: 340, h: 12 });
    elements.push({ kind: 'text', x: 180, y: y + 11, text: `第${index + 1}张` });
  }
  const bottom = top + count * gap;
  elements.push({ kind: 'rect', x: 250, y: bottom, w: 340, h: 12 });
  elements.push({ kind: 'text', x: 390, y: bottom + 34, text: '摩擦片' });
  elements.push({ kind: 'arrow', from: [570, top + 6], to: [650, top + 6], label: 'f滚轮', color: '#2f5bea' });
  elements.push({ kind: 'arrow', from: [570, top + gap * 2 + 6], to: [650, top + gap * 2 + 6], label: '层间摩擦', color: '#67c23a' });
  elements.push({ kind: 'arrow', from: [250, bottom + 34], to: [160, bottom + 34], label: 'f', color: '#f56c6c' });
  elements.push({ kind: 'text', x: 100, y: 340, text: '滚轮带动第1张，纸间摩擦逐层传递，摩擦片拦住整叠' });
  return {
    type: 'physics',
    title: '打印机进纸：层间摩擦力',
    spec: { elements },
    basis: `识别到打印机进纸模型，${count} 张纸`,
  };
}

function modelIncline(question: string): ModeledVisualization | null {
  if (!/斜面|倾角|斜坡|传送带/.test(question)) return null;
  const text = normalizeText(question);
  const angleMatch = text.match(/(?:倾角|角度)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? text.match(/(\d+(?:\.\d+)?)\s*°/);
  const angle = angleMatch ? Number(angleMatch[1]) : 30;
  const massMatch = text.match(/(?:质量|物重)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:kg|千克)?/);
  const muMatch = text.match(/(?:摩擦因数|摩擦系数|μ)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const mass = massMatch ? Number(massMatch[1]) : null;
  const mu = muMatch ? Number(muMatch[1]) : null;
  const rad = (angle * Math.PI) / 180;
  const start = [80, 340];
  const length = 500;
  const end = [round(start[0] + length * Math.cos(rad)), round(start[1] - length * Math.sin(rad))];
  const t = 0.58;
  const cx = round(start[0] + (end[0] - start[0]) * t);
  const cy = round(start[1] + (end[1] - start[1]) * t);
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [40, 340], to: [660, 340], label: '地面' },
    { kind: 'line', from: start as [number, number], to: end as [number, number], label: `斜面 ${angle}°` },
    { kind: 'rect', x: cx - 35, y: cy - 45, w: 70, h: 44, label: mass ? `m=${mass}kg` : 'm', rotate: -angle },
    { kind: 'arrow', from: [cx, cy], to: [cx, cy + 90], label: mass ? `G=${round(mass * 9.8, 1)}N` : 'G', color: '#f56c6c' },
    { kind: 'arrow', from: [cx, cy], to: [round(cx - 60 * Math.sin(rad)), round(cy - 60 * Math.cos(rad))], label: 'N', color: '#409eff' },
    { kind: 'arrow', from: [cx, cy], to: [round(cx + 70 * Math.cos(rad)), round(cy - 70 * Math.sin(rad))], label: mu !== null ? `f（μ=${mu}）` : 'f', color: '#67c23a' },
    { kind: 'text', x: 420, y: 380, text: mu !== null ? `沿斜面分解重力，f = μN` : '沿斜面与垂直斜面分解重力' },
  ];
  return {
    type: 'physics',
    title: clampText(`斜面受力分析（倾角 ${angle}°${mass ? `，m=${mass}kg` : ''}）`),
    spec: { elements },
    basis: `解析到斜面倾角 ${angle}°${mass ? `、质量 ${mass}kg` : ''}${mu !== null ? `、摩擦因数 ${mu}` : ''}`,
  };
}

function modelCircuit(question: string): ModeledVisualization | null {
  if (!/电路|电阻|欧姆|电流|电压|串联|并联/.test(question)) return null;
  const text = normalizeText(question);
  const resistors = [...text.matchAll(/R\s*(\d+)?\s*=\s*(\d+(?:\.\d+)?)\s*(?:Ω|欧)?/gi)].map((match) => ({
    name: `R${match[1] ?? ''}`,
    value: Number(match[2]),
  }));
  const voltageMatch = text.match(/(?:U|电压)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:V|伏)?/);
  const voltage = voltageMatch ? Number(voltageMatch[1]) : null;
  const parallel = /并联/.test(text);
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [120, 100], to: [560, 100] },
    { kind: 'line', from: [560, 100], to: [560, 310] },
    { kind: 'line', from: [560, 310], to: [120, 310] },
    { kind: 'line', from: [120, 310], to: [120, 100] },
    { kind: 'circle', x: 120, y: 205, r: 24, label: voltage !== null ? `U=${voltage}V` : 'U' },
  ];
  if (parallel) {
    elements.push(
      { kind: 'line', from: [300, 100], to: [300, 170] },
      { kind: 'line', from: [300, 240], to: [300, 310] },
      { kind: 'line', from: [300, 170], to: [450, 170] },
      { kind: 'line', from: [450, 170], to: [450, 240] },
      { kind: 'line', from: [300, 240], to: [450, 240] },
      { kind: 'rect', x: 330, y: 154, w: 90, h: 32, label: resistors[0] ? `${resistors[0].name}=${resistors[0].value}Ω` : 'R1' },
      { kind: 'rect', x: 330, y: 224, w: 90, h: 32, label: resistors[1] ? `${resistors[1].name}=${resistors[1].value}Ω` : 'R2' },
    );
  } else {
    elements.push(
      { kind: 'rect', x: 220, y: 84, w: 90, h: 32, label: resistors[0] ? `${resistors[0].name}=${resistors[0].value}Ω` : 'R1' },
      { kind: 'rect', x: 390, y: 84, w: 90, h: 32, label: resistors[1] ? `${resistors[1].name}=${resistors[1].value}Ω` : 'R2' },
      { kind: 'arrow', from: [200, 100], to: [250, 100], label: 'I', color: '#e6a23c' },
    );
  }
  const values = resistors.map((item) => item.value).filter((value) => Number.isFinite(value));
  let currentText = 'I = U / R';
  if (voltage !== null && values.length > 0) {
    const equivalent = parallel
      ? 1 / values.reduce((sum, value) => sum + 1 / value, 0)
      : values.reduce((sum, value) => sum + value, 0);
    if (Number.isFinite(equivalent) && equivalent !== 0) {
      currentText = `I = ${voltage} / ${round(equivalent, 2)} = ${round(voltage / equivalent, 3)} A`;
    }
  }
  elements.push({ kind: 'text', x: 250, y: 350, text: currentText });
  return {
    type: 'physics',
    title: clampText(`${parallel ? '并联' : '串联'}电路${voltage !== null ? `（U=${voltage}V）` : ''}`),
    spec: { elements },
    basis: `解析到${parallel ? '并联' : '串联'}电路${resistors.length ? `，${resistors.length} 个电阻` : ''}`,
  };
}

function modelLens(question: string): ModeledVisualization | null {
  if (!/透镜|焦距|物距|成像|光路/.test(question)) return null;
  const text = normalizeText(question);
  const fMatch = text.match(/焦距(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  const uMatch = text.match(/物距(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
  if (!fMatch || !uMatch) return null;
  const f = Number(fMatch[1]);
  const u = Number(uMatch[1]);
  if (!(f > 0) || !(u > 0)) return null;
  const concave = /凹透镜/.test(text);
  const focal = concave ? -f : f;
  const v = 1 / (1 / focal - 1 / u);
  const scale = 260 / Math.max(u, Math.abs(v) || u);
  const center = 360;
  const objectX = center - u * scale;
  const imageX = center + v * scale;
  const objectHeight = 46;
  const imageHeight = Number.isFinite(v) ? (-objectHeight * v) / u : 0;
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [60, 210], to: [660, 210], label: '主光轴' },
    { kind: 'line', from: [center, 80], to: [center, 340], label: '透镜' },
    { kind: 'arrow', from: [objectX, 210], to: [objectX, 210 - objectHeight], label: '物', color: '#2f5bea' },
    { kind: 'arrow', from: [imageX, 210], to: [imageX, 210 - imageHeight], label: '像', color: '#f56c6c' },
    { kind: 'line', from: [objectX, 210 - objectHeight], to: [center, 210], label: '' },
    { kind: 'line', from: [center, 210], to: [imageX, 210 - imageHeight], label: '' },
    { kind: 'text', x: 80, y: 380, text: `f=${f} ${concave ? '（凹透镜）' : ''}，u=${u}，v=${round(v, 2)}` },
  ];
  return {
    type: 'diagram',
    title: clampText(`${concave ? '凹' : '凸'}透镜成像（f=${f}，u=${u}）`),
    spec: { elements },
    basis: `解析到焦距 ${f}、物距 ${u}`,
  };
}

function modelPlaneGeometry(question: string): ModeledVisualization | null {
  const text = normalizeText(question);
  if (!/正方形|矩形|长方形|三角形|直角三角形|等边三角形|平行四边形|梯形|圆/.test(text)) return null;

  const elements: Record<string, unknown>[] = [];
  const numberAfter = (pattern: RegExp): number | null => {
    const match = text.match(pattern);
    return match ? Number(match[1]) : null;
  };

  if (/圆/.test(text) && !/三角形|正方形|矩形|梯形|平行四边形/.test(text)) {
    const radiusValue = numberAfter(/(?:半径)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
    const diameterValue = numberAfter(/(?:直径)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/);
    const radius = radiusValue ?? (diameterValue ? diameterValue / 2 : 2);
    const r = Math.min(140, Math.max(30, radius * 28));
    elements.push(
      { kind: 'circle', x: 360, y: 205, r, label: 'O' },
      { kind: 'line', from: [360, 205], to: [360 + r, 205] },
      { kind: 'text', x: 360 + r / 2, y: 198, text: `r=${round(radius, 3)}` },
      { kind: 'text', x: 320, y: 300, text: `圆：半径 ${round(radius, 3)}` },
    );
    return {
      type: 'diagram',
      title: clampText(`圆（半径 ${round(radius, 3)}）`),
      spec: { elements },
      basis: `解析到圆半径 ${round(radius, 3)}`,
    };
  }

  if (/正方形|矩形|长方形/.test(text)) {
    const side = numberAfter(/(?:边长|长|宽)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? 3;
    const width = numberAfter(/长(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? side;
    const height = numberAfter(/宽(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? side;
    const w = Math.min(420, Math.max(80, width * 48));
    const h = Math.min(240, Math.max(60, height * 48));
    const x = 360 - w / 2;
    const y = 210 - h / 2;
    elements.push(
      { kind: 'rect', x, y, w, h, label: /正方形/.test(text) ? '正方形' : '矩形' },
      { kind: 'text', x: x + w / 2, y: y + h + 26, text: `长 ${width}` },
      { kind: 'text', x: x - 34, y: y + h / 2, text: `宽 ${height}` },
    );
    return {
      type: 'diagram',
      title: clampText(
        /正方形/.test(text) ? `正方形（边长 ${width}）` : `矩形（长 ${width}，宽 ${height}）`,
      ),
      spec: { elements },
      basis: /正方形/.test(text) ? `解析到正方形边长 ${width}` : `解析到矩形长 ${width}、宽 ${height}`,
    };
  }

  if (/三角形/.test(text)) {
    const right = /直角三角形/.test(text);
    const legPair = text.match(/直角边[^0-9]*(\d+(?:\.\d+)?)[^0-9]*(\d+(?:\.\d+)?)/);
    const legA = legPair ? Number(legPair[1]) : 3;
    const legB = legPair ? Number(legPair[2]) : 4;
    const generalSide = numberAfter(/(?:边长|三边)(?:为|是|=)?\s*(\d+(?:\.\d+)?)/) ?? 3;
    const scale = 46;
    const vertices: { id: string; x: number; y: number }[] = right
      ? [
          { id: 'A', x: 140, y: 320 },
          { id: 'B', x: 140 + legA * scale, y: 320 },
          { id: 'C', x: 140, y: 320 - legB * scale },
        ]
      : [
          { id: 'A', x: 140, y: 320 },
          { id: 'B', x: 140 + generalSide * scale, y: 320 },
          { id: 'C', x: 140 + (generalSide * scale) / 2, y: 320 - generalSide * scale * 0.866 },
        ];
    const [a, b, c] = vertices;
    elements.push(
      { kind: 'line', from: [a.x, a.y], to: [b.x, b.y] },
      { kind: 'line', from: [b.x, b.y], to: [c.x, c.y] },
      { kind: 'line', from: [c.x, c.y], to: [a.x, a.y] },
      { kind: 'text', x: a.x - 20, y: a.y + 18, text: a.id },
      { kind: 'text', x: b.x + 8, y: b.y + 18, text: b.id },
      { kind: 'text', x: c.x - 10, y: c.y - 12, text: c.id },
    );
    if (right) {
      elements.push(
        { kind: 'text', x: a.x + 10, y: a.y - 8, text: '90°' },
        { kind: 'text', x: (a.x + b.x) / 2, y: a.y + 20, text: `${legA}` },
        { kind: 'text', x: a.x - 18, y: (a.y + c.y) / 2, text: `${legB}` },
        { kind: 'text', x: (b.x + c.x) / 2 + 6, y: (b.y + c.y) / 2, text: `斜边 ${round(Math.hypot(legA, legB), 3)}` },
      );
    } else {
      elements.push({ kind: 'text', x: (a.x + b.x) / 2, y: a.y + 22, text: `边长 ${generalSide}` });
    }
    return {
      type: 'diagram',
      title: clampText(right ? `直角三角形（直角边 ${legA}、${legB}）` : `三角形（边长 ${generalSide}）`),
      spec: { elements },
      basis: right ? `解析到直角三角形两直角边 ${legA}、${legB}` : `解析到三角形边长 ${generalSide}`,
    };
  }

  return null;
}

function modelHorizontalForces(question: string): ModeledVisualization | null {
  if (!/受力分析|摩擦力|水平面|水平地面/.test(question)) return null;
  if (!/物体|物块|滑块|木块/.test(question)) return null;
  const text = normalizeText(question);
  const massMatch = text.match(/(?:质量|物重)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:kg|千克)?/);
  const forceMatch = text.match(/(?:拉力|推力|F)(?:为|是|=)?\s*(\d+(?:\.\d+)?)\s*(?:N|牛)?/);
  const mass = massMatch ? Number(massMatch[1]) : null;
  const force = forceMatch ? Number(forceMatch[1]) : null;
  const elements: Record<string, unknown>[] = [
    { kind: 'line', from: [80, 300], to: [640, 300], label: '水平面' },
    { kind: 'rect', x: 310, y: 240, w: 110, h: 60, label: mass ? `m=${mass}kg` : 'm' },
    { kind: 'arrow', from: [365, 270], to: [365, 350], label: mass ? `G=${round(mass * 9.8, 1)}N` : 'G', color: '#f56c6c' },
    { kind: 'arrow', from: [365, 270], to: [365, 180], label: 'N', color: '#409eff' },
    { kind: 'arrow', from: [420, 270], to: [520, 270], label: force ? `F=${force}N` : 'F', color: '#67c23a' },
    { kind: 'arrow', from: [310, 270], to: [210, 270], label: 'f', color: '#e6a23c' },
  ];
  return {
    type: 'physics',
    title: clampText(`水平面上物体的受力分析${mass ? `（m=${mass}kg）` : ''}`),
    spec: { elements },
    basis: `解析到水平面受力${mass ? `，质量 ${mass}kg` : ''}`,
  };
}

export { modelCircuit, modelHorizontalForces, modelIncline, modelLens, modelPaperFeed, modelPlaneGeometry };
