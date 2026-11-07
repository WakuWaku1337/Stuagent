import { Hono } from 'hono';
import {
  analyzeExam,
  compareExams,
  getExam,
  listExamSummaries,
  recognizeFromImage,
  recognizeFromText,
  savePaper,
} from '../learning/exams.ts';
import { parseDocx, parsePdf } from '../documents/parsers.ts';

const reviews = new Hono();

reviews.get('/compare', (c) => c.json(compareExams(c.req.query('subject'))));

reviews.get('/', (c) => c.json({ exams: listExamSummaries() }));

reviews.post('/recognize', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) return c.json({ error: '缺少 file 字段' }, 400);
      const buffer = Buffer.from(await file.arrayBuffer());
      const name = file.name || 'exam';
      const kind = file.type || '';
      let paper;
      if (/^image\/(png|jpe?g|webp)$/.test(kind)) {
        const dataUrl = `data:${kind};base64,${buffer.toString('base64')}`;
        paper = await recognizeFromImage(dataUrl, name);
      } else if (kind === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
        const blocks = await parsePdf(buffer);
        paper = await recognizeFromText(blocks.map((b) => b.text).join('\n'), name);
      } else if (name.toLowerCase().endsWith('.docx')) {
        const blocks = await parseDocx(buffer);
        paper = await recognizeFromText(blocks.map((b) => b.text).join('\n'), name);
      } else {
        paper = await recognizeFromText(buffer.toString('utf8'), name);
      }
      const saved = savePaper(paper, name);
      return c.json({ ...saved, paper });
    }

    const body = await c.req.json<{ text?: string; name?: string }>().catch(() => null);
    if (!body?.text?.trim()) return c.json({ error: '缺少 text 或 file' }, 400);
    const paper = await recognizeFromText(body.text, body.name);
    const saved = savePaper(paper, body.name ?? 'text');
    return c.json({ ...saved, paper });
  } catch (e) {
    return c.json({ code: 'RECOGNIZE_FAILED', message: e instanceof Error ? e.message : String(e) }, 422);
  }
});

reviews.get('/:id', (c) => {
  const detail = getExam(c.req.param('id'));
  return detail ? c.json(detail) : c.json({ error: '试卷不存在' }, 404);
});

reviews.post('/:id/analyze', async (c) => {
  try {
    return c.json(await analyzeExam(c.req.param('id')));
  } catch (e) {
    return c.json({ code: 'ANALYZE_FAILED', message: e instanceof Error ? e.message : String(e) }, 422);
  }
});

export default reviews;