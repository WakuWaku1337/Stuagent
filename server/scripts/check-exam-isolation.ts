/**
 * B1-1 回归：考试复盘写入题库时必须带 learner_id，且 A/B/default 三方互相不可见。
 * 不依赖真实模型：LLM_API_KEY 置空后 buildReport 走确定性回退。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/check-exam-isolation.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-exam-iso-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.LLM_API_KEY = '';
process.env.LLM_BASE_URL = 'http://127.0.0.1:1/v1';

const { db } = await import('../src/store.ts');
const { runWithLearner } = await import('../src/learning/context.ts');
const { analyzeExam, savePaper } = await import('../src/learning/exams.ts');
const { listQuestions } = await import('../src/learning/questions.ts');
const { listWrongRecords } = await import('../src/learning/wrongbook.ts');

let failures = 0;
function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const learnerA = { learnerId: 'learner-a', userId: 'user-a', role: 'user' as const };
const learnerB = { learnerId: 'learner-b', userId: 'user-b', role: 'user' as const };

try {
  const saved = runWithLearner(learnerA, () =>
    savePaper(
      {
        name: '考试隔离测试卷',
        subject: '数学',
        total_score: 10,
        my_score: 6,
        questions: [
          {
            question_no: 1,
            question_type: '解答题',
            full_score: 10,
            got_score: 6,
            correct_answer: 'A',
            knowledge_point: '函数单调性',
            content: '考试隔离测试题',
            is_correct: false,
          },
        ],
      },
      'unit-test',
    ),
  );
  report(Boolean(saved.exam_id), 'exam paper saved for learner A', saved.exam_id);

  await runWithLearner(learnerA, () => analyzeExam(saved.exam_id));
  report(true, 'analyzeExam runs offline');

  const own = runWithLearner(learnerA, () => listQuestions({}));
  const examQuestions = own.filter((q) => q.source === `exam:${saved.exam_id}`);
  report(
    examQuestions.length === 1 && examQuestions[0].learner_id === 'learner-a',
    'exam question is owned by learner A',
    JSON.stringify(examQuestions.map((q) => ({ id: q.question_id, learner: q.learner_id }))),
  );

  const other = runWithLearner(learnerB, () => listQuestions({}));
  report(
    other.every((q) => q.source !== `exam:${saved.exam_id}`),
    'learner B cannot see learner A exam question',
    `${other.length} questions`,
  );

  const legacy = runWithLearner({ learnerId: 'default', userId: 'default', role: 'admin' }, () =>
    listQuestions({}),
  );
  report(
    legacy.every((q) => q.source !== `exam:${saved.exam_id}`),
    'default learner cannot see learner A exam question',
    `${legacy.length} questions`,
  );

  const aWrong = listWrongRecords('learner-a');
  const bWrong = listWrongRecords('learner-b');
  report(
    aWrong.some((r) => r.question_id === examQuestions[0]?.question_id),
    'learner A wrongbook keeps the snapshot',
    `${aWrong.length} records`,
  );
  report(bWrong.length === 0, 'learner B wrongbook is empty', `${bWrong.length} records`);

  const stored = db
    .prepare('SELECT learner_id FROM questions WHERE source = ?')
    .get(`exam:${saved.exam_id}`) as { learner_id: string } | undefined;
  report(stored?.learner_id === 'learner-a', 'database row stores learner_id', stored?.learner_id ?? 'missing');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
