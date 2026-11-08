export interface DailyPractice {
  date: string;
  learner_id: string;
  session_id: string;
  total: number;
  status: 'active' | 'completed';
  score: number | null;
  created_at: number;
  finished_at: number | null;
}

export interface DailyQuestion {
  question_id: string;
  knowledge_point: string;
  difficulty: string;
  content: string;
  options: Record<string, string>;
}

export interface DailyHistoryItem {
  date: string;
  status: 'active' | 'completed';
  score: number | null;
  total: number;
}

export interface DailyOverview {
  practice: DailyPractice | null;
  questions: DailyQuestion[];
  answered_ids: string[];
  streak: number;
  history: DailyHistoryItem[];
  recommendation: { focus_points: string[]; due_wrong: number };
}

export interface StartDailyResult {
  practice: DailyPractice;
  questions: DailyQuestion[];
  answered_ids: string[];
  reused: boolean;
  streak: number;
}

export interface GradeResult {
  question_id: string;
  is_correct: boolean;
  correct_answer: string;
  student_answer: string;
  explanation: string | null;
  knowledge_point: string;
  mastery: number;
  wrong_record_id?: string;
}

export interface AnswerDailyResult {
  result: GradeResult;
  practice: DailyPractice;
  streak: number;
  completed: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export function fetchDaily(): Promise<DailyOverview> {
  return request('/api/daily');
}

export function startDaily(subject?: string): Promise<StartDailyResult> {
  return request('/api/daily/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: subject?.trim() || undefined }),
  });
}

export function answerDaily(questionId: string, answer: string): Promise<AnswerDailyResult> {
  return request('/api/daily/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_id: questionId, answer }),
  });
}
