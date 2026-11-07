import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { searchKnowledge } = await import('../src/rag/service.ts');

interface Case {
  query: string;
  expect_source: string;
}

const cases: Case[] = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'testdata', 'eval-rag.json'), 'utf8'));

let hit1 = 0;
let hit3 = 0;
let hit5 = 0;
let mrr = 0;
let recall = 0;
const latencies: number[] = [];

for (const c of cases) {
  const t0 = Date.now();
  const result = await searchKnowledge(c.query, { topK: 5 });
  latencies.push(Date.now() - t0);
  const names = result.citations.map((x) => x.source_name);
  const rank = names.findIndex((n) => n === c.expect_source);
  if (rank === 0) hit1++;
  if (rank >= 0 && rank < 3) hit3++;
  if (rank >= 0) hit5++;
  if (rank >= 0) mrr += 1 / (rank + 1);
  if (names.includes(c.expect_source)) recall++;
  console.log(
    `${rank >= 0 ? 'HIT ' : 'MISS'} ${c.query} -> ${names.join(', ') || '(空)'} ${rank >= 0 ? `(rank ${rank + 1})` : ''}`,
  );
}

const n = cases.length;
latencies.sort((a, b) => a - b);
const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
console.log('---');
console.log(`cases: ${n}`);
console.log(`Hit@1: ${hit1}/${n} = ${((hit1 / n) * 100).toFixed(1)}%`);
console.log(`Hit@3: ${hit3}/${n} = ${((hit3 / n) * 100).toFixed(1)}%`);
console.log(`Hit@5: ${hit5}/${n} = ${((hit5 / n) * 100).toFixed(1)}%`);
console.log(`Recall@5: ${recall}/${n} = ${((recall / n) * 100).toFixed(1)}%`);
console.log(`MRR: ${(mrr / n).toFixed(3)}`);
console.log(`latency P50/P95: ${p(0.5)}ms / ${p(0.95)}ms`);
