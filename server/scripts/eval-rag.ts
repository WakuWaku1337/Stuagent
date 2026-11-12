import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { searchKnowledge } = await import('../src/rag/service.ts');
const { EVAL_ENABLE_ADVANCED } = await import('../src/config.ts');

interface Case {
  query: string;
  expect_source: string;
  /** 可选：人工标注的相关性等级（source -> grade），用于 Precision@K / nDCG@K */
  relevant_sources?: { source: string; grade: number }[];
  /** 可选：标准答案，用于答案级引用判定；缺失时输出不可计算 */
  answer?: string;
  /** 可选：人工标注该问题应引用的来源，用于检索级引用正确率代理指标 */
  expected_citations?: string[];
}

const cases: Case[] = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'testdata', 'eval-rag.json'), 'utf8'));

let hit1 = 0;
let hit3 = 0;
let hit5 = 0;
let mrr = 0;
let recall = 0;
const latencies: number[] = [];
const rows: { item: Case; names: string[]; citedSources: string[] }[] = [];

for (const c of cases) {
  const t0 = Date.now();
  const result = await searchKnowledge(c.query, { topK: 5, noCache: true });
  latencies.push(Date.now() - t0);
  const names = result.citations.map((x) => x.source_name);
  rows.push({ item: c, names, citedSources: result.citations.map((x) => x.source_name) });
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

if (!EVAL_ENABLE_ADVANCED) {
  console.log('高级指标: 未启用（EVAL_ENABLE_ADVANCED=0）');
} else {
  const labelled = rows.filter((row) => (row.item.relevant_sources?.length ?? 0) > 0);
  if (labelled.length === 0) {
    console.log('Precision@5: 不可计算（标注缺少相关性等级）');
    console.log('nDCG@5: 不可计算（标注缺少相关性等级）');
    console.log('引用命中率: 不可计算（标注缺少相关性等级）');
  } else {
    let precisionSum = 0;
    let ndcgSum = 0;
    let citationPrecisionSum = 0;
    for (const row of labelled) {
      const grades = new Map((row.item.relevant_sources ?? []).map((entry) => [entry.source, entry.grade]));
      const top = row.names.slice(0, 5);
      const relevant = top.filter((name) => (grades.get(name) ?? 0) > 0);
      precisionSum += top.length > 0 ? relevant.length / top.length : 0;
      const dcg = top.reduce((sum, name, index) => sum + (grades.get(name) ?? 0) / Math.log2(index + 2), 0);
      const ideal = [...grades.values()]
        .sort((a, b) => b - a)
        .slice(0, 5)
        .reduce((sum, grade, index) => sum + grade / Math.log2(index + 2), 0);
      ndcgSum += ideal > 0 ? dcg / ideal : 0;
      // C04：引用命中率按实际引用来源去重计算，与检索 Precision@K 分开命名。
      const cited = [...new Set(row.citedSources)].slice(0, 5);
      citationPrecisionSum += cited.length > 0
        ? cited.filter((name) => (grades.get(name) ?? 0) > 0).length / cited.length
        : 0;
    }
    const coverage = `${labelled.length}/${n} 有标注`;
    console.log(`Precision@5: ${((precisionSum / labelled.length) * 100).toFixed(1)}%（${coverage}）`);
    console.log(`nDCG@5: ${(ndcgSum / labelled.length).toFixed(3)}（${coverage}）`);
    console.log(`引用命中率 (Citation Precision@5): ${((citationPrecisionSum / labelled.length) * 100).toFixed(1)}%（${coverage}）`);
  }

  // C04：引用正确率是答案级判定，禁止用来源相关性换算冒充。
  const answerLabelled = rows.filter(
    (row) => Boolean(row.item.answer?.trim()) && (row.item.expected_citations?.length ?? 0) > 0,
  );
  if (answerLabelled.length === 0) {
    console.log('引用正确率: 不可计算（缺少 expected_citations 与标准答案标注）');
  } else {
    let correctSum = 0;
    for (const row of answerLabelled) {
      const expected = new Set(row.item.expected_citations ?? []);
      const cited = [...new Set(row.citedSources)];
      correctSum += cited.length > 0 ? cited.filter((name) => expected.has(name)).length / cited.length : 0;
    }
    console.log(
      `引用正确率（检索级代理）: ${((correctSum / answerLabelled.length) * 100).toFixed(1)}%（${answerLabelled.length}/${n} 有标注）`,
    );
    console.log('提示：生成答案级引用正确率需 LLM-as-Judge 或人工复核，本检索脚本不可计算');
  }
}

// C05：标注缺失不算失败，显式给出通过退出码。
process.exitCode = 0;
