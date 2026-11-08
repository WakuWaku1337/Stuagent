import { randomUUID } from 'node:crypto';
import { db, listDocuments } from '../store.ts';
import { DEFAULT_LEARNER } from './memory.ts';
import { listMastery } from './mastery.ts';
import { listWrongRecords } from './wrongbook.ts';

export type PlanStatus = 'active' | 'completed' | 'archived';
export type PlanTaskType = 'review' | 'wrongbook' | 'practice' | 'reading' | 'summary';

export interface PlanTask {
  task_id: string;
  type: PlanTaskType;
  title: string;
  detail: string;
  done: boolean;
  knowledge_point?: string;
}

export interface PlanDay {
  date: string;
  weekday: string;
  focus: string;
  minutes: number;
  tasks: PlanTask[];
}

export interface PlanContent {
  summary: string;
  focus_points: string[];
  days: PlanDay[];
  source: {
    weak_points: { knowledge_point: string; probability: number }[];
    due_wrong: number;
    documents: string[];
    generated_at: number;
  };
}

export interface LearningPlan {
  plan_id: string;
  learner_id: string;
  goal: string;
  subjects: string[];
  start_date: string;
  days: number;
  daily_minutes: number;
  status: PlanStatus;
  progress: number;
  content: PlanContent;
  created_at: number;
  updated_at: number;
}

export interface PlanHistoryItem {
  plan_id: string;
  goal: string;
  status: PlanStatus;
  progress: number;
  days: number;
  start_date: string;
  updated_at: number;
}

export interface PlanOverview {
  plan: LearningPlan | null;
  history: PlanHistoryItem[];
}

export interface CreatePlanInput {
  goal: string;
  days?: number;
  dailyMinutes?: number;
  subjects?: string[];
}

export class PlanError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'PlanError';
    this.code = code;
    this.status = status;
  }
}

interface PlanDbRow {
  plan_id: string;
  learner_id: string;
  goal: string;
  subjects: string | null;
  start_date: string;
  days: number;
  daily_minutes: number;
  status: PlanStatus;
  progress: number;
  content: string;
  created_at: number;
  updated_at: number;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeGoal(value: unknown): string {
  const goal = typeof value === 'string' ? value.trim() : '';
  if (goal.length < 2) throw new PlanError('PLAN_GOAL_REQUIRED', '请填写至少 2 个字的学习目标');
  if (goal.length > 200) throw new PlanError('PLAN_GOAL_TOO_LONG', '学习目标不能超过 200 字');
  return goal;
}

function normalizeDays(value: unknown, fallback = 7): number {
  const days = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(days) || days < 1 || days > 60) {
    throw new PlanError('PLAN_DAYS_RANGE', '计划天数必须在 1~60 天之间');
  }
  return Math.round(days);
}

function normalizeMinutes(value: unknown, fallback = 30): number {
  const minutes = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(minutes) || minutes < 10 || minutes > 180) {
    throw new PlanError('PLAN_MINUTES_RANGE', '每日学习时长必须在 10~180 分钟之间');
  }
  return Math.round(minutes);
}

function normalizeSubjects(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError('PLAN_SUBJECTS_INVALID', 'subjects 必须是字符串数组');
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map((item) => item.slice(0, 20));
  return [...new Set(items)].slice(0, 6);
}

function parseSnapshotPoint(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { knowledge_point?: unknown };
    return typeof parsed.knowledge_point === 'string' ? parsed.knowledge_point.trim() : '';
  } catch {
    return '';
  }
}

function buildContent(input: {
  goal: string;
  days: number;
  dailyMinutes: number;
  subjects: string[];
}): PlanContent {
  const mastery = listMastery(DEFAULT_LEARNER);
  const weak = mastery.filter((row) => row.probability < 0.85).slice(0, 8);
  const due = listWrongRecords(DEFAULT_LEARNER, true);
  const duePoints = due.map((row) => parseSnapshotPoint(row.question_snapshot)).filter(Boolean);
  const documents = listDocuments()
    .filter((doc) => doc.status === 'parsed' || doc.status === 'indexed')
    .filter((doc) => {
      if (input.subjects.length === 0) return true;
      const subject = doc.subject ?? '';
      return input.subjects.some((item) => subject.includes(item) || doc.filename.includes(item));
    });
  const subjectPoints = input.subjects.map((subject) => `${subject}基础`);

  const focusPoints = [
    ...new Set([
      ...weak.map((row) => row.knowledge_point),
      ...duePoints,
      ...subjectPoints,
    ]),
  ].slice(0, 8);
  if (focusPoints.length === 0) {
    focusPoints.push(input.goal.length > 18 ? `${input.goal.slice(0, 18)}…` : input.goal);
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days: PlanDay[] = [];
  for (let index = 0; index < input.days; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const focus = focusPoints[index % focusPoints.length];
    const focusMastery = mastery.find((row) => row.knowledge_point === focus);
    const tasks: PlanTask[] = [
      {
        task_id: `d${index + 1}-review`,
        type: 'review',
        title: `复习薄弱知识点：${focus}`,
        detail: focusMastery
          ? `当前掌握度 ${(focusMastery.probability * 100).toFixed(1)}%，先回顾定义、定理与例题，再做一道基础题确认理解`
          : '回顾定义、定理与例题，整理一张知识卡片',
        done: false,
        knowledge_point: focus,
      },
    ];
    if (due.length > 0) {
      tasks.push({
        task_id: `d${index + 1}-wrongbook`,
        type: 'wrongbook',
        title: '复习到期错题',
        detail: `今天到期 ${due.length} 道，先完成 2 道并按遗忘曲线重新安排`,
        done: false,
      });
    }
    tasks.push({
      task_id: `d${index + 1}-practice`,
      type: 'practice',
      title: `完成 3 道「${focus}」练习`,
      detail: '在智能出题中选择对应知识点；作答后查看解析，错题会自动进入错题本',
      done: false,
      knowledge_point: focus,
    });
    if (documents.length > 0 && index % 2 === 0) {
      const doc = documents[index % documents.length];
      tasks.push({
        task_id: `d${index + 1}-reading`,
        type: 'reading',
        title: `阅读资料《${doc.filename}》`,
        detail: `结合「${focus}」定位相关章节，记下 1~2 个仍不清楚的问题`,
        done: false,
      });
    }
    if (index === input.days - 1) {
      tasks.push({
        task_id: `d${index + 1}-summary`,
        type: 'summary',
        title: '阶段复盘',
        detail: '回看完成情况与错题变化，整理下一阶段要优先攻克的 1~3 个知识点',
        done: false,
      });
    }
    days.push({
      date: isoDate(date),
      weekday: WEEKDAYS[date.getDay()],
      focus,
      minutes: input.dailyMinutes,
      tasks,
    });
  }

  const weakText = weak.length
    ? `优先补 ${weak.map((row) => row.knowledge_point).slice(0, 3).join('、')}`
    : '从当前目标与已有资料出发安排基础复习';
  return {
    summary: `未来 ${input.days} 天，每天 ${input.dailyMinutes} 分钟：${weakText}${
      due.length ? `，并复习 ${due.length} 道到期错题` : ''
    }。`,
    focus_points: focusPoints,
    days,
    source: {
      weak_points: weak.map((row) => ({
        knowledge_point: row.knowledge_point,
        probability: Math.round(row.probability * 1000) / 10,
      })),
      due_wrong: due.length,
      documents: documents.slice(0, 5).map((doc) => doc.filename),
      generated_at: Date.now(),
    },
  };
}

function toPlan(row: PlanDbRow): LearningPlan {
  let subjects: string[] = [];
  try {
    const parsed = JSON.parse(row.subjects ?? '[]');
    if (Array.isArray(parsed)) subjects = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    subjects = [];
  }
  return {
    plan_id: row.plan_id,
    learner_id: row.learner_id,
    goal: row.goal,
    subjects,
    start_date: row.start_date,
    days: row.days,
    daily_minutes: row.daily_minutes,
    status: row.status,
    progress: row.progress,
    content: JSON.parse(row.content) as PlanContent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findPlan(id: string): LearningPlan | undefined {
  const row = db.prepare('SELECT * FROM learning_plans WHERE plan_id = ?').get(id) as
    | PlanDbRow
    | undefined;
  return row ? toPlan(row) : undefined;
}

function recalc(content: PlanContent): { progress: number; total: number; done: number } {
  const tasks = content.days.flatMap((day) => day.tasks);
  const done = tasks.filter((task) => task.done).length;
  return {
    progress: tasks.length > 0 ? Math.round((done / tasks.length) * 1000) / 1000 : 0,
    total: tasks.length,
    done,
  };
}

function history(limit = 8): PlanHistoryItem[] {
  return db
    .prepare(
      `SELECT plan_id, goal, status, progress, days, start_date, updated_at
       FROM learning_plans WHERE learner_id = ? AND status = 'archived'
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(DEFAULT_LEARNER, limit) as unknown as PlanHistoryItem[];
}

export function getPlanOverview(): PlanOverview {
  const row = db
    .prepare(
      `SELECT * FROM learning_plans WHERE learner_id = ? AND status IN ('active', 'completed')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(DEFAULT_LEARNER) as PlanDbRow | undefined;
  return {
    plan: row ? toPlan(row) : null,
    history: history(),
  };
}

export function getPlan(id: string): LearningPlan | undefined {
  return findPlan(id);
}

export function createPlan(input: CreatePlanInput): LearningPlan {
  const goal = normalizeGoal(input.goal);
  const days = normalizeDays(input.days);
  const dailyMinutes = normalizeMinutes(input.dailyMinutes);
  const subjects = normalizeSubjects(input.subjects);
  const content = buildContent({ goal, days, dailyMinutes, subjects });
  const now = Date.now();
  const id = randomUUID();
  const startDate = content.days[0]?.date ?? isoDate(new Date());

  db.prepare(
    `UPDATE learning_plans SET status = 'archived', updated_at = ?
     WHERE learner_id = ? AND status IN ('active', 'completed')`,
  ).run(now, DEFAULT_LEARNER);
  db.prepare(
    `INSERT INTO learning_plans
       (plan_id, learner_id, goal, subjects, start_date, days, daily_minutes, status, progress, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
  ).run(
    id,
    DEFAULT_LEARNER,
    goal,
    JSON.stringify(subjects),
    startDate,
    days,
    dailyMinutes,
    JSON.stringify(content),
    now,
    now,
  );
  return findPlan(id)!;
}

export function updatePlan(
  id: string,
  patch: { goal?: string; days?: number; dailyMinutes?: number; subjects?: string[] },
): LearningPlan {
  const existing = findPlan(id);
  if (!existing) throw new PlanError('PLAN_NOT_FOUND', '学习计划不存在', 404);
  if (existing.status === 'archived') throw new PlanError('PLAN_ARCHIVED', '已归档的计划不能编辑', 409);

  const goal = normalizeGoal(patch.goal ?? existing.goal);
  const days = normalizeDays(patch.days ?? existing.days);
  const dailyMinutes = normalizeMinutes(patch.dailyMinutes ?? existing.daily_minutes);
  const subjects = normalizeSubjects(patch.subjects ?? existing.subjects);
  const content = buildContent({ goal, days, dailyMinutes, subjects });
  const now = Date.now();
  db.prepare(
    `UPDATE learning_plans
     SET goal = ?, subjects = ?, start_date = ?, days = ?, daily_minutes = ?, status = 'active',
         progress = 0, content = ?, updated_at = ?
     WHERE plan_id = ?`,
  ).run(
    goal,
    JSON.stringify(subjects),
    content.days[0]?.date ?? isoDate(new Date()),
    days,
    dailyMinutes,
    JSON.stringify(content),
    now,
    id,
  );
  return findPlan(id)!;
}

export function togglePlanTask(id: string, taskId: string, done: boolean): LearningPlan {
  const plan = findPlan(id);
  if (!plan) throw new PlanError('PLAN_NOT_FOUND', '学习计划不存在', 404);
  if (plan.status === 'archived') throw new PlanError('PLAN_ARCHIVED', '已归档的计划不能修改', 409);
  const task = plan.content.days.flatMap((day) => day.tasks).find((item) => item.task_id === taskId);
  if (!task) throw new PlanError('PLAN_TASK_NOT_FOUND', '计划任务不存在', 404);
  task.done = done;
  const { progress } = recalc(plan.content);
  db.prepare(
    `UPDATE learning_plans SET content = ?, progress = ?, status = ?, updated_at = ? WHERE plan_id = ?`,
  ).run(
    JSON.stringify(plan.content),
    progress,
    progress >= 1 ? 'completed' : 'active',
    Date.now(),
    id,
  );
  return findPlan(id)!;
}

export function archivePlan(id: string): LearningPlan {
  const plan = findPlan(id);
  if (!plan) throw new PlanError('PLAN_NOT_FOUND', '学习计划不存在', 404);
  db.prepare(`UPDATE learning_plans SET status = 'archived', updated_at = ? WHERE plan_id = ?`).run(
    Date.now(),
    id,
  );
  return findPlan(id)!;
}

export function deletePlan(id: string): boolean {
  const result = db.prepare('DELETE FROM learning_plans WHERE plan_id = ?').run(id);
  return result.changes > 0;
}

export function planStats(plan: LearningPlan): { total: number; done: number; days: number; remaining_days: number } {
  const stats = recalc(plan.content);
  const today = isoDate(new Date());
  return {
    total: stats.total,
    done: stats.done,
    days: plan.content.days.length,
    remaining_days: plan.content.days.filter((day) => day.date >= today).length,
  };
}
