import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { chatJson } from '../learning/llm.ts';

export interface CoursewareRow {
  courseware_id: string;
  title: string;
  topic: string;
  subject: string | null;
  html: string;
  source: string;
  created_at: number;
}

const PROMPT = `你是交互课件作者。生成一个单文件 HTML 课件，要求：
1. 只输出 JSON：{"title":"课件标题","html":"完整 HTML 字符串"}；
2. HTML 必须是完整的 <!doctype html> 文档，所有 CSS/JS 内联，**禁止任何外部资源**（无 CDN、无外链图片/字体/脚本）；
3. 用 <canvas> 或内联 <svg> 做可交互演示：至少一个 range 滑块和一处实时重绘；
4. 中文标签，含标题、公式说明（纯文本即可）、交互操作提示；
5. 代码简洁可运行，不使用 import/export、不使用 fetch。`;

export async function generateCourseware(input: {
  topic: string;
  subject?: string;
}): Promise<CoursewareRow> {
  let title = `${input.topic} · 交互课件`;
  let html = '';
  let source = 'llm';
  try {
    const result = await chatJson<{ title?: string; html?: string }>(
      [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `主题：${input.topic}${input.subject ? `（${input.subject}）` : ''}` },
      ],
      { scenario: 'courseware', subject: input.subject },
    );
    const candidate = stripFence(result.html ?? '');
    if (isValidHtml(candidate)) {
      html = candidate;
      title = result.title?.trim() || title;
    }
  } catch {
    // 落入模板
  }
  if (!html) {
    html = fallbackHtml(input.topic);
    source = 'template';
  }

  const row: CoursewareRow = {
    courseware_id: randomUUID(),
    title,
    topic: input.topic,
    subject: input.subject ?? null,
    html,
    source,
    created_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO courseware (courseware_id, title, topic, subject, html, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(row.courseware_id, row.title, row.topic, row.subject, row.html, row.source, row.created_at);
  return row;
}

export function listCourseware(): Omit<CoursewareRow, 'html'>[] {
  return db
    .prepare('SELECT courseware_id, title, topic, subject, source, created_at FROM courseware ORDER BY created_at DESC')
    .all() as unknown as Omit<CoursewareRow, 'html'>[];
}

export function getCourseware(id: string): CoursewareRow | undefined {
  return db.prepare('SELECT * FROM courseware WHERE courseware_id = ?').get(id) as unknown as CoursewareRow | undefined;
}

export function deleteCourseware(id: string): void {
  db.prepare('DELETE FROM courseware WHERE courseware_id = ?').run(id);
}

function stripFence(html: string): string {
  return html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/** 离线要求：无外部资源，必须有交互画布 */
export function isValidHtml(html: string): boolean {
  if (html.length < 400 || html.length > 300_000) return false;
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) return false;
  if (!/<canvas[\s>]|<svg[\s>]/i.test(html)) return false;
  if (/\b(src|href)\s*=\s*["']https?:\/\//i.test(html)) return false;
  if (/<script[^>]+src=/i.test(html)) return false;
  if (/@import\s+url\(/i.test(html)) return false;
  return true;
}

/** 兜底课件：勾股定理可交互演示（无外部依赖） */
export function fallbackHtml(topic: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(topic)} · 交互课件</title>
<style>
body{font-family:'Microsoft YaHei',system-ui;margin:0;background:#f8fafc;color:#1f2937}
header{padding:20px 28px;background:#fff;border-bottom:1px solid #e5e7eb}
h1{font-size:20px;margin:0 0 6px}small{color:#6b7280}
main{display:flex;gap:24px;padding:24px;flex-wrap:wrap}
canvas{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
aside{width:300px;background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
label{display:block;margin:14px 0 6px;font-size:14px}
input[type=range]{width:100%}
.value{color:#2563eb;font-weight:600}
.formula{margin-top:18px;padding:12px;background:#eff6ff;border-radius:8px;font-size:15px;line-height:1.8}
</style></head>
<body>
<header><h1>${escapeHtml(topic)} · 交互课件</h1><small>拖动滑块观察三角形与正方形面积的变化（单文件离线可用）</small></header>
<main>
<canvas id="c" width="520" height="460"></canvas>
<aside>
  <label>直角边 a：<span id="va" class="value">3.0</span></label>
  <input id="a" type="range" min="1" max="8" step="0.1" value="3">
  <label>直角边 b：<span id="vb" class="value">4.0</span></label>
  <input id="b" type="range" min="1" max="8" step="0.1" value="4">
  <div class="formula" id="f"></div>
  <p style="color:#6b7280;font-size:13px">勾股定理：直角三角形两条直角边的平方和等于斜边的平方。两个小正方形的面积之和等于大正方形的面积。</p>
</aside>
</main>
<script>
const c = document.getElementById('c'), ctx = c.getContext('2d');
const A = document.getElementById('a'), B = document.getElementById('b');
function draw(){
  const a = +A.value, b = +B.value;
  document.getElementById('va').textContent = a.toFixed(1);
  document.getElementById('vb').textContent = b.toFixed(1);
  const hyp = Math.sqrt(a*a + b*b);
  const s = 40, ox = 70, oy = 380;
  const ax = ox + a*s, ay = oy - b*s;
  ctx.clearRect(0,0,c.width,c.height);
  // 三角形
  ctx.fillStyle = 'rgba(37,99,235,.12)'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ax,oy); ctx.lineTo(ax,ay); ctx.closePath(); ctx.fill(); ctx.stroke();
  // a 正方形
  ctx.fillStyle = 'rgba(16,185,129,.18)'; ctx.strokeStyle = '#059669';
  ctx.fillRect(ox, oy, a*s, a*s); ctx.strokeRect(ox, oy, a*s, a*s);
  // b 正方形
  ctx.fillStyle = 'rgba(245,158,11,.20)'; ctx.strokeStyle = '#d97706';
  ctx.fillRect(ax, ay, b*s, b*s); ctx.strokeRect(ax, ay, b*s, b*s);
  ctx.fillStyle = '#374151'; ctx.font = '13px Microsoft YaHei';
  ctx.fillText('a=' + a.toFixed(1), ox + a*s/2 - 16, oy + a*s/2);
  ctx.fillText('b=' + b.toFixed(1), ax + b*s/2 - 16, ay + b*s/2);
  ctx.strokeStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ax,ay); ctx.stroke();
  ctx.fillStyle = '#dc2626'; ctx.fillText('c=' + hyp.toFixed(2), (ox+ax)/2 + 8, (oy+ay)/2 - 8);
  document.getElementById('f').innerHTML =
    'a² + b² = ' + (a*a).toFixed(2) + ' + ' + (b*b).toFixed(2) + ' = ' + (a*a+b*b).toFixed(2) + '<br>' +
    'c = √(a² + b²) = <b>' + hyp.toFixed(2) + '</b>';
}
A.oninput = B.oninput = draw; draw();
</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}