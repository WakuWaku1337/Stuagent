import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-plan-'));
process.env.EDU_DATA_DIR = dataDir;

const { PlanError, archivePlan, createPlan, deletePlan, getPlanOverview, planStats, togglePlanTask, updatePlan } =
  await import('../src/learning/plan.ts');
const { db } = await import('../src/store.ts');

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

function expectPlanError(action: () => unknown, code: string): boolean {
  try {
    action();
    return false;
  } catch (error) {
    return error instanceof PlanError && error.code === code;
  }
}

try {
  const created = createPlan({
    goal: '两周补完函数基础，期末数学提高 15 分',
    days: 7,
    dailyMinutes: 30,
    subjects: ['数学'],
  });
  const taskCount = created.content.days.flatMap((day) => day.tasks).length;
  report(
    created.days === 7 &&
      created.daily_minutes === 30 &&
      created.subjects.includes('数学') &&
      created.status === 'active' &&
      created.progress === 0 &&
      created.content.days.length === 7 &&
      taskCount >= 7 &&
      created.content.focus_points.length >= 1,
    'create plan',
    `${created.content.days.length} days, ${taskCount} tasks`,
  );

  const overview = getPlanOverview();
  report(overview.plan?.plan_id === created.plan_id && overview.history.length === 0, 'active plan overview');

  const firstTask = created.content.days[0].tasks[0];
  const partial = togglePlanTask(created.plan_id, firstTask.task_id, true);
  report(partial.progress > 0 && partial.progress < 1, 'toggle task updates progress', `${partial.progress}`);
  const reverted = togglePlanTask(created.plan_id, firstTask.task_id, false);
  report(reverted.progress === 0, 'toggle task can be reverted');

  const updated = updatePlan(created.plan_id, { goal: '四周系统提分', days: 14, dailyMinutes: 45 });
  report(
    updated.goal === '四周系统提分' &&
      updated.days === 14 &&
      updated.daily_minutes === 45 &&
      updated.status === 'active' &&
      updated.progress === 0 &&
      updated.content.days.length === 14,
    'adjust plan regenerates tasks',
  );

  let current = updated;
  for (const day of current.content.days) {
    for (const task of day.tasks) {
      current = togglePlanTask(current.plan_id, task.task_id, true);
    }
  }
  report(current.progress === 1 && current.status === 'completed', 'all tasks completed', `${current.progress}`);
  report(planStats(current).total === planStats(current).done, 'plan stats match');

  const archived = archivePlan(created.plan_id);
  const afterArchive = getPlanOverview();
  report(
    archived.status === 'archived' &&
      afterArchive.plan === null &&
      afterArchive.history.some((item) => item.plan_id === created.plan_id),
    'archive plan moves to history',
  );

  report(expectPlanError(() => createPlan({ goal: '' }), 'PLAN_GOAL_REQUIRED'), 'reject empty goal');
  report(expectPlanError(() => createPlan({ goal: '目标', days: 0 }), 'PLAN_DAYS_RANGE'), 'reject days out of range');
  report(expectPlanError(() => createPlan({ goal: '目标', dailyMinutes: 5 }), 'PLAN_MINUTES_RANGE'), 'reject minutes out of range');
  report(
    expectPlanError(() => updatePlan(created.plan_id, { goal: '归档后再改' }), 'PLAN_ARCHIVED'),
    'reject editing archived plan',
  );

  report(deletePlan(created.plan_id), 'delete archived plan');
  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
