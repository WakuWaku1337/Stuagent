import './lib/same-origin-fetch.ts';
import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

async function main() {
  const status = await fetch(`${BASE}/api/asr`).then((res) => res.json());
  console.log(`${status.ready ? 'PASS' : 'FAIL'} asr model ready (${status.model ?? 'unknown'})`);
  if (!status.ready) {
    console.error(status.hint ?? '请在 server 目录运行 npm run asr:model');
    process.exitCode = 1;
    return;
  }

  const wav = await readFile('testdata/asr-question-16k.wav');
  const form = new FormData();
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'asr-question.wav');
  const asr = await fetch(`${BASE}/api/asr`, { method: 'POST', body: form }).then((res) => res.json());
  const textOk = typeof asr.text === 'string' && asr.text.includes('直角');
  console.log(`${textOk ? 'PASS' : 'FAIL'} asr (${asr.latency_ms ?? '?'}ms): ${asr.text ?? ''}`);

  const ttsRes = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '你好，这是语音播报测试。', rate: 1.1, volume: 0.8 }),
  });
  const contentType = ttsRes.headers.get('content-type') ?? '';
  let ttsOk = false;
  let ttsMode = '';
  if (contentType.includes('application/json')) {
    const tts = await ttsRes.json();
    ttsMode = tts.mode;
    ttsOk = ttsRes.status === 200 && (tts.mode === 'browser' || tts.mode === 'server') && tts.volume === 0.8;
  } else {
    ttsMode = 'server';
    ttsOk = ttsRes.status === 200 && (await ttsRes.arrayBuffer()).byteLength > 0;
  }
  console.log(`${ttsOk ? 'PASS' : 'FAIL'} tts mode: ${ttsMode}`);

  const ok = textOk && ttsOk;
  console.log(ok ? 'ALL PASS' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
