import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { ensureCollection } = await import('../src/rag/milvus.ts');
const { indexDocument, searchKnowledge } = await import('../src/rag/service.ts');
const { listDocuments } = await import('../src/store.ts');

const step = process.argv[2] ?? 'all';

if (step === 'init' || step === 'all') {
  await ensureCollection();
  console.log('collection ready');
}

if (step === 'index' || step === 'all') {
  for (const doc of listDocuments()) {
    const n = await indexDocument(doc.document_id);
    console.log(`indexed ${doc.filename}: ${n} chunks`);
  }
}

if (step === 'search' || step === 'all') {
  const query = process.argv[3] ?? '勾股定理的内容是什么？';
  const result = await searchKnowledge(query, { topK: 5 });
  console.log('query:', query);
  for (const c of result.citations) {
    console.log(`[${c.index}] ${c.source_name} | ${c.chapter} | p${c.page} | score=${c.score.toFixed(3)} | ${c.snippet.slice(0, 50)}`);
  }
}