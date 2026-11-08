import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { db } = await import('../src/store.ts');
const { runWithLearner } = await import('../src/learning/context.ts');
const { indexDocument } = await import('../src/rag/service.ts');

const docs = db.prepare('SELECT document_id, filename, learner_id FROM documents ORDER BY created_at ASC').all() as unknown as {
  document_id: string;
  filename: string;
  learner_id: string;
}[];
const reindex = process.argv.includes('--reindex');
console.log(`文档 ${docs.length} 个；默认账号沿用旧 collection edu_chunks，${reindex ? '现在重建向量' : '跳过向量重建（加 --reindex 强制）'}`);

let ok = 0;
let failed = 0;
if (reindex) {
  for (const doc of docs) {
    try {
      await runWithLearner(
        { learnerId: doc.learner_id, userId: doc.learner_id, role: 'user' },
        () => indexDocument(doc.document_id),
      );
      ok += 1;
      console.log(`PASS ${doc.document_id} ${doc.filename}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${doc.document_id} ${doc.filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const counts = {
  users: (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n,
  documents: (db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n,
  conversations: (db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n,
  wrong_records: (db.prepare('SELECT COUNT(*) AS n FROM wrong_records').get() as { n: number }).n,
};
console.log('---');
console.log(JSON.stringify(counts));
console.log(`Milvus 重建：${ok} 成功 / ${failed} 失败`);
if (failed > 0) process.exit(1);
