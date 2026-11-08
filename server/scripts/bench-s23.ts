const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const USER = process.env.AUTH_TEST_USER ?? 'admin';
const PASSWORD = process.env.AUTH_TEST_PASSWORD ?? 'admin12345';
const query = process.env.BENCH_QUERY ?? '勾股定理';
const includeChat = process.argv.includes('--chat');
const chatMessage = process.env.BENCH_CHAT_MESSAGE ?? '只回答：好';

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
});
if (!login.ok) throw new Error(`登录失败：${login.status}`);
const cookie = (login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie') ?? '').split(';')[0];

async function search(): Promise<{ status: number; body: any }> {
  const response = await fetch(BASE + '/api/knowledge/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, topK: 5 }),
  });
  return { status: response.status, body: await response.json() };
}

const coldStart = performance.now();
const cold = await search();
const coldMs = performance.now() - coldStart;
console.log(`RAG cold: ${coldMs.toFixed(1)}ms cached=${Boolean(cold.body?.cached)}`);
const times: number[] = [];
let cachedHits = 0;
for (let i = 0; i < 10; i += 1) {
  const start = performance.now();
  const result = await search();
  times.push(performance.now() - start);
  if (result.body?.cached) cachedHits += 1;
}
console.log(`RAG query: ${query}`);
console.log(`RAG P50=${percentile(times, 0.5).toFixed(1)}ms P95=${percentile(times, 0.95).toFixed(1)}ms cache_hits=${cachedHits}/10`);

if (includeChat) {
  const ttft: number[] = [];
  const total: number[] = [];
  const runs = Math.max(1, Number(process.env.BENCH_CHAT_RUNS ?? 3));
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    const response = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: chatMessage, stream: true, reasoning: 'low' }),
    });
    if (!response.ok || !response.body) throw new Error(`chat 失败：${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let first = 0;
    let done = 0;
    let cached = false;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!first && buffer.includes('event: delta')) first = performance.now() - start;
      if (buffer.includes('"cached":true')) cached = true;
      if (buffer.includes('event: done')) {
        done = performance.now() - start;
        break;
      }
    }
    await reader.cancel().catch(() => undefined);
    const totalMs = done || performance.now() - start;
    console.log(`Chat run ${i + 1}: TTFT=${(first || totalMs).toFixed(1)}ms total=${totalMs.toFixed(1)}ms cached=${cached}`);
    ttft.push(first || done);
    total.push(totalMs);
  }
  console.log(`Chat TTFT P50=${percentile(ttft, 0.5).toFixed(1)}ms P95=${percentile(ttft, 0.95).toFixed(1)}ms`);
  console.log(`Chat total P50=${percentile(total, 0.5).toFixed(1)}ms P95=${percentile(total, 0.95).toFixed(1)}ms`);
}
