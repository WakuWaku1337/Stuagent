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

export interface PlanSource {
  weak_points: { knowledge_point: string; probability: number }[];
  due_wrong: number;
  documents: string[];
  generated_at: number;
}

export interface PlanContent {
  summary: string;
  focus_points: string[];
  days: PlanDay[];
  source: PlanSource;
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

export interface PlanStats {
  total: number;
  done: number;
  days: number;
  remaining_days: number;
}

export interface PlanOverview {
  plan: LearningPlan | null;
  history: PlanHistoryItem[];
  stats: PlanStats | null;
}

export interface PlanInput {
  goal: string;
  days?: number;
  dailyMinutes?: number;
  subjects?: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `请求失败（${res.status}）`);
  }
  return data as T;
}

export function fetchPlan(): Promise<PlanOverview> {
  return request<PlanOverview>('/api/plan');
}

export function generatePlan(input: PlanInput): Promise<{ plan: LearningPlan; stats: PlanStats }> {
  return request('/api/plan/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updatePlan(
  planId: string,
  input: PlanInput,
): Promise<{ plan: LearningPlan; stats: PlanStats }> {
  return request(`/api/plan/${planId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function togglePlanTask(
  planId: string,
  taskId: string,
  done: boolean,
): Promise<{ plan: LearningPlan; stats: PlanStats }> {
  return request(`/api/plan/${planId}/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
}

export function archivePlan(planId: string): Promise<{ plan: LearningPlan }> {
  return request(`/api/plan/${planId}/archive`, { method: 'POST' });
}
