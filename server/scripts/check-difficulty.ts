import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-difficulty-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const { recommendDifficulty } = await import('../src/learning/quiz.ts');
const { saveMastery } = await import('../src/learning/mastery.ts');

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

try {
  const unknown = recommendDifficulty('未记录知识点');
  report(
    unknown.difficulty === '中等' && unknown.probability === null,
    'unknown knowledge point defaults to medium',
  );

  saveMastery({
    learner_id: 'default',
    knowledge_point: '基础薄弱',
    probability: 0.32,
    correct_count: 1,
    wrong_count: 4,
    updated_at: Date.now(),
  });
  const basic = recommendDifficulty('基础薄弱');
  report(basic.difficulty === '基础' && basic.probability === 32, 'low mastery recommends basic');

  saveMastery({
    learner_id: 'default',
    knowledge_point: '中等掌握',
    probability: 0.62,
    correct_count: 5,
    wrong_count: 2,
    updated_at: Date.now(),
  });
  const medium = recommendDifficulty('中等掌握');
  report(medium.difficulty === '中等' && medium.probability === 62, 'mid mastery recommends medium');

  saveMastery({
    learner_id: 'default',
    knowledge_point: '掌握良好',
    probability: 0.88,
    correct_count: 8,
    wrong_count: 1,
    updated_at: Date.now(),
  });
  const advanced = recommendDifficulty('掌握良好');
  report(advanced.difficulty === '拔高' && advanced.probability === 88, 'high mastery recommends advanced');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
