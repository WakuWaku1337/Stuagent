import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-daily-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const { DailyError, answerDaily, dailyHistory, dailyStreak, getDailyOverview, startDaily } =
  await import('../src/learning/daily.ts');

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

function expectDailyError(action: () => unknown, code: string): boolean {
  try {
    action();
    return false;
  } catch (error) {
    return error instanceof DailyError && error.code === code;
  }
}

try {
  const insert = db.prepare(
    `INSERT INTO questions (question_id, bank_id, subject, knowledge_point, difficulty, content, options, answer, explanation, source, created_at)
     VALUES (?, 'test', '数学', '综合', '基础', ?, ?, 'A', '测试解析', 'check-daily', ?)`,
  );
  for (let index = 1; index <= 5; index += 1) {
    insert.run(
      `daily-q-${index}`,
      `测试题 ${index}：1 + ${index} = ?`,
      JSON.stringify({ A: String(1 + index), B: '0', C: '1', D: '2' }),
      Date.now(),
    );
  }

  const empty = getDailyOverview();
  report(empty.practice === null && empty.streak === 0, 'empty daily overview');
  report(
    empty.recommendation.focus_points.includes('综合') && empty.recommendation.due_wrong === 0,
    'daily recommendation',
  );

  const first = await startDaily();
  report(
    first.practice.status === 'active' &&
      first.questions.length === 5 &&
      first.answered_ids.length === 0 &&
      first.reused === false,
    'start daily',
    `${first.questions.length} questions`,
  );

  const reused = await startDaily();
  report(
    reused.reused === true &&
      reused.practice.session_id === first.practice.session_id &&
      reused.questions.length === 5,
    'daily is idempotent per day',
  );

  for (let index = 0; index < 5; index += 1) {
    const question = first.questions[index];
    const result = answerDaily(question.question_id, 'A');
    if (index < 4) {
      report(
        result.completed === false && result.practice.status === 'active',
        `answer ${index + 1}/5`,
      );
    } else {
      report(
        result.completed === true &&
          result.practice.status === 'completed' &&
          result.practice.score === 100 &&
          result.streak === 1,
        'complete daily practice',
        `score ${result.practice.score}`,
      );
    }
  }

  report(
    expectDailyError(() => answerDaily(first.questions[0].question_id, 'A'), 'DAILY_COMPLETED'),
    'reject answer after completion',
  );

  const completed = getDailyOverview();
  report(
    completed.practice?.status === 'completed' &&
      completed.practice.score === 100 &&
      completed.questions.length === 0 &&
      completed.history[0]?.status === 'completed',
    'completed overview',
  );

  const completedAgain = await startDaily();
  report(
    completedAgain.reused === true &&
      completedAgain.practice.status === 'completed' &&
      completedAgain.questions.length === 0,
    'start returns completed practice',
  );

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  const yesterdayDate = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  db.prepare(
    `INSERT INTO daily_practices (date, learner_id, session_id, total, status, score, created_at, finished_at)
     VALUES (?, 'default', 'manual-yesterday', 5, 'completed', 80, ?, ?)`,
  ).run(yesterdayDate, Date.now() - 86400000, Date.now() - 86400000);
  report(dailyStreak() === 2, 'streak counts consecutive days', `${dailyStreak()} days`);
  report(dailyHistory(7).length === 2, 'daily history');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
