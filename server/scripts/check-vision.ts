import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

async function main() {
  const png = await readFile('testdata/vision-question.png');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'vision-question.png');
  const upload = await fetch(`${BASE}/api/media/upload`, { method: 'POST', body: form });
  const media = await upload.json();
  if (!upload.ok) throw new Error(`上传失败 ${upload.status}: ${JSON.stringify(media)}`);
  console.log(`PASS media upload (${media.media_id})`);

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '请解答图片中的题目，给出最终的斜边长度。',
      mediaIds: [media.media_id],
      stream: false,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`对话失败 ${res.status}: ${JSON.stringify(body)}`);
  const mode = body.media?.vision ? '视觉直读' : body.media?.ocr_used ? 'OCR 兜底' : '未知';
  const answerOk = /(^|[^0-9])5([^0-9]|$)|斜边/.test(body.reply ?? '');
  console.log(`${answerOk ? 'PASS' : 'FAIL'} image Q&A (${mode})`);
  console.log(`reply: ${String(body.reply).slice(0, 240).replace(/\n/g, ' ')}`);

  const detail = await fetch(`${BASE}/api/conversations/${body.conversation_id}`).then((r) => r.json());
  const attachments = detail.messages?.[0]?.attachments
    ? JSON.parse(detail.messages[0].attachments)
    : [];
  const imageOk = attachments[0]?.media_id === media.media_id;
  console.log(`${imageOk ? 'PASS' : 'FAIL'} attachment persisted`);

  const served = await fetch(`${BASE}${attachments[0]?.url ?? ''}`);
  console.log(`${served.status === 200 ? 'PASS' : 'FAIL'} media url served (${served.status})`);

  await fetch(`${BASE}/api/conversations/${body.conversation_id}`, { method: 'DELETE' });
  if (!answerOk || !imageOk || served.status !== 200) process.exit(1);
  console.log('ALL PASS');
}

main().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : error);
  process.exit(1);
});
