/**
 * 历史数据修复：考试复盘写入题库时遗漏 learner_id 的存量题目。
 *
 * 默认 dry-run，只输出清单；核对后加 --apply 才会在事务内更新并先做 SQLite 快照。
 * 关联依据只有 questions.source = 'exam:' || exam_papers.exam_id，不按 bank_id/题目内容猜测。
 *
 * 用法（在 server/ 目录下）：
 *   node --import jiti/register scripts/repair-exam-question-owner.ts
 *   node --import jiti/register scripts/repair-exam-question-owner.ts --apply
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db, dbPath } from '../src/store.ts';

const apply = process.argv.includes('--apply');

interface Candidate {
  question_id: string;
  exam_id: string;
  paper_name: string | null;
  source: string;
  current_owner: string;
  target_owner: string;
}

const rows = db
  .prepare(
    `SELECT q.question_id,
            ep.exam_id,
            ep.name AS paper_name,
            q.source,
            q.learner_id AS current_owner,
            ep.learner_id AS target_owner
     FROM questions q
     JOIN exam_papers ep ON q.source = 'exam:' || ep.exam_id
     WHERE q.learner_id = 'default'
       AND q.source LIKE 'exam:%'
       AND ep.learner_id <> 'default'
     ORDER BY ep.created_at ASC, q.created_at ASC`,
  )
  .all() as unknown as Candidate[];

const wrongCount = db.prepare('SELECT COUNT(*) AS n FROM wrong_records WHERE question_id = ?');
const withWrong = rows.map((row) => ({
  ...row,
  wrong_records: (wrongCount.get(row.question_id) as { n: number }).n,
}));

console.log(`模式：${apply ? 'APPLY（写入）' : 'DRY-RUN（只读）'}`);
console.log(`待修复题目：${rows.length} 条`);

const byExam = new Map<string, Candidate[]>();
for (const row of rows) {
  const list = byExam.get(row.exam_id) ?? [];
  list.push(row);
  byExam.set(row.exam_id, list);
}
for (const [examId, list] of byExam) {
  const first = list[0];
  console.log(
    `- exam_id=${examId} 试卷=${first.paper_name ?? '(未命名)'} 题目=${list.length} ` +
      `归属=${first.current_owner} -> ${first.target_owner}`,
  );
}
const mismatched = withWrong.filter((row) => row.current_owner === row.target_owner);
if (mismatched.length > 0) {
  console.log(`警告：${mismatched.length} 条记录的当前归属已等于目标归属，将跳过`);
}

if (rows.length === 0) {
  console.log('没有需要修复的题目。');
  process.exit(0);
}
if (!apply) {
  console.log('未写入数据库。核对清单后加 --apply 执行。');
  process.exit(0);
}

const backupDir = join(dirname(dbPath()), 'backups');
await mkdir(backupDir, { recursive: true });
const backupPath = join(backupDir, `edu-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''").replace(/\\/g, '/')}'`);
console.log(`已备份 SQLite：${backupPath}`);

const update = db.prepare(
  'UPDATE questions SET learner_id = ? WHERE question_id = ? AND learner_id = ?',
);
let changed = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    if (row.current_owner === row.target_owner) continue;
    const result = update.run(row.target_owner, row.question_id, row.current_owner);
    changed += Number(result.changes);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const left = db
  .prepare(
    `SELECT COUNT(*) AS n
     FROM questions q
     JOIN exam_papers ep ON q.source = 'exam:' || ep.exam_id
     WHERE q.learner_id = 'default' AND q.source LIKE 'exam:%' AND ep.learner_id <> 'default'`,
  )
  .get() as { n: number };
console.log(`已更新：${changed} 条；剩余待修复：${left.n} 条`);
db.close();
process.exit(left.n === 0 && changed === rows.length ? 0 : 1);
