import type { HealthResponse } from './http';

export interface ModelInfo {
  provider?: string;
  model?: string;
  baseUrl?: string;
  configured?: boolean;
  error?: string;
  vision?: boolean;
  image_mode?: 'vision' | 'ocr' | 'none';
}

export interface DocumentItem {
  document_id: string;
  filename: string;
  file_type: string;
  size: number;
  subject: string | null;
  tags?: string | null;
  source_path?: string | null;
  status: string;
  chunk_count: number;
  error: string | null;
  created_at: number;
}

export interface MasteryItem {
  knowledge_point: string;
  probability: number;
  percent: number;
  mastered: boolean;
  correct_count: number;
  wrong_count: number;
  updated_at?: number;
}

export interface WrongSnapshot {
  content: string;
  options?: Record<string, string>;
  answer?: string;
  explanation?: string | null;
  knowledge_point?: string;
  difficulty?: string;
  exam?: string;
}

export interface WrongRecord {
  record_id: string;
  question_id?: string;
  question_snapshot: WrongSnapshot;
  student_answer: string | null;
  reason: string | null;
  review_count: number;
  interval_days: number;
  next_review: number;
  created_at?: number;
  last_review?: number | null;
}

export interface ExamSummary {
  exam_id: string;
  name: string;
  subject: string | null;
  exam_date: string | null;
  total_score: number | null;
  my_score: number | null;
  duration?: number | null;
  source?: string;
  status: string;
  question_count: number;
  reviewed: boolean;
}

export interface ExamQuestion {
  question_no: number;
  question_type: string | null;
  full_score: number | null;
  got_score: number | null;
  is_correct: number | null;
  student_answer: string | null;
  correct_answer: string | null;
  error_reason: string | null;
  knowledge_point: string | null;
  content: string | null;
}

export interface ExamDetail {
  paper: ExamSummary;
  questions: ExamQuestion[];
  review?: { report: string } | null;
}

export interface CompareSeriesItem {
  exam_id: string;
  name: string;
  date: string;
  score: number;
  total: number;
  rate: number;
}

export interface CompareResult {
  subject: string | null;
  series: CompareSeriesItem[];
  weakest: { knowledge_point: string; lost: number; wrong: number }[];
  summary: string;
}

export interface CoursewareItem {
  courseware_id: string;
  title: string;
  topic: string;
  subject: string | null;
  source: string;
  created_at: number;
}

export interface TaskItem {
  task_id: string;
  type: string;
  status: string;
  payload: string;
  result: string | null;
  error: string | null;
  attempts: number;
  created_at: number;
}

export type ReasoningLevel = 'low' | 'medium' | 'high';

export interface ProviderModelOption {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  inputPrice: number;
  outputPrice: number;
  vision?: boolean;
}

export interface ProviderOption {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  requiresKey: boolean;
  note: string | null;
  env: boolean;
  models: ProviderModelOption[];
}

export interface ScenarioParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface ModelSettingsInfo {
  provider: string;
  providerName: string;
  model: string;
  baseUrl: string;
  reasoning: ReasoningLevel;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextLength: number;
  scenarioParams: Record<string, ScenarioParams>;
  monthlyBudget: number;
  updatedAt: number;
  requiresKey: boolean;
  configured: boolean;
  keyCount: number;
  reasoningOptions: Record<ReasoningLevel, string>;
}

export interface ApiKeyInfo {
  key_id: string;
  provider: string;
  label: string;
  masked: string;
  source: 'db' | 'env' | 'none';
  status: 'active' | 'cooling' | 'missing';
  fail_count: number;
  cooldown_until: number | null;
  last_error: string | null;
  last_used_at: number | null;
  created_at: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  provider: string;
  model: string;
  message: string;
}

export interface UsageGroup {
  label: string;
  calls: number;
  tokens: number;
  cost: number;
  successRate: number;
  avgLatencyMs: number;
}

export interface UsageSummary {
  range: { days: number; from: number; to: number };
  currency: string;
  summary: {
    calls: number;
    successCalls: number;
    failedCalls: number;
    successRate: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens: number;
    cost: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  byModel: UsageGroup[];
  byScenario: UsageGroup[];
  bySubject: UsageGroup[];
  budget: {
    monthlyBudget: number;
    monthCost: number;
    percent: number;
    warning: boolean;
    currency: string;
  };
}

export interface UsageDaily {
  date: string;
  calls: number;
  tokens: number;
  cost: number;
  successRate: number;
  avgLatencyMs: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `请求失败（${res.status}）`);
  }
  return data as T;
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  model: () => request<ModelInfo>('/api/model'),
  documents: () => request<{ documents: DocumentItem[] }>('/api/documents'),
  mastery: () => request<{ mastery: MasteryItem[] }>('/api/mastery'),
  wrongbook: () => request<{ records: WrongRecord[]; due: number }>('/api/wrongbook'),
  exams: () => request<{ exams: ExamSummary[] }>('/api/reviews'),
  compareExams: () => request<CompareResult>('/api/reviews/compare'),
  examDetail: (id: string) => request<ExamDetail>(`/api/reviews/${id}`),
  courseware: () => request<{ items: CoursewareItem[] }>('/api/courseware'),
  tasks: () => request<{ tasks: TaskItem[] }>('/api/tasks'),
  settingsProviders: () =>
    request<{ providers: ProviderOption[]; reasoningOptions: Record<ReasoningLevel, string> }>(
      '/api/settings/providers',
    ),
  settingsModel: () => request<ModelSettingsInfo>('/api/settings/model'),
  updateModelSettings: (body: {
    provider: string;
    model: string;
    baseUrl?: string;
    contextLength?: number;
  }) =>
    request<ModelSettingsInfo>('/api/settings/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateReasoning: (reasoning: ReasoningLevel) =>
    request<ModelSettingsInfo>('/api/settings/reasoning', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasoning }),
    }),
  updateGeneration: (body: {
    temperature: number;
    topP: number;
    maxTokens: number;
    contextLength: number;
    monthlyBudget: number;
    scenarioParams: Record<string, ScenarioParams>;
  }) =>
    request<ModelSettingsInfo>('/api/settings/generation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  settingsKeys: (provider: string) =>
    request<{ provider: string; keys: ApiKeyInfo[] }>(
      `/api/settings/keys?provider=${encodeURIComponent(provider)}`,
    ),
  saveApiKey: (body: {
    provider: string;
    label: string;
    apiKey: string;
    model?: string;
    baseUrl?: string;
    keyId?: string;
  }) =>
    request<{ key: ApiKeyInfo }>('/api/settings/apikey', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', ...body }),
    }),
  deleteApiKey: (keyId: string) =>
    request<{ deleted: string }>('/api/settings/apikey', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', keyId }),
    }),
  testConnection: (body: {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    keyId?: string;
  }) =>
    request<ConnectionTestResult>('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  usageSummary: (days: number) => request<UsageSummary>(`/api/usage/summary?days=${days}`),
  usageDaily: (days: number) =>
    request<{ days: number; daily: UsageDaily[] }>(`/api/usage/daily?days=${days}`),
};
