import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { getSettings } from '../settings/store.ts';

export interface UsageInput {
  provider: string;
  model: string;
  scenario: string;
  subject?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  cost?: number;
  success?: boolean;
  error?: string | null;
  keyId?: string | null;
}

export interface UsageTimeRow {
  date: string;
  calls: number;
  tokens: number;
  cost: number;
  successRate: number;
  avgLatencyMs: number;
}

export interface UsageGroupRow {
  label: string;
  calls: number;
  tokens: number;
  cost: number;
  successRate: number;
  avgLatencyMs: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function recordUsage(input: UsageInput): void {
  try {
    db.prepare(
      `INSERT INTO usage_records
       (usage_id, learner_id, provider, model, scenario, subject, prompt_tokens, completion_tokens,
        total_tokens, reasoning_tokens, latency_ms, cost, success, error, key_id, created_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.provider,
      input.model,
      input.scenario,
      input.subject ?? null,
      Math.max(0, Math.round(input.promptTokens ?? 0)),
      Math.max(0, Math.round(input.completionTokens ?? 0)),
      Math.max(0, Math.round(input.totalTokens ?? 0)),
      Math.max(0, Math.round(input.reasoningTokens ?? 0)),
      Math.max(0, Math.round(input.latencyMs ?? 0)),
      round(Math.max(0, input.cost ?? 0), 6),
      input.success === false ? 0 : 1,
      input.error?.slice(0, 1000) ?? null,
      input.keyId ?? null,
      Date.now(),
    );
  } catch (error) {
    console.error('[usage] 记录失败:', error instanceof Error ? error.message : error);
  }
}

function since(days: number): number {
  return Date.now() - Math.max(1, days) * 86_400_000;
}

export function usageSummary(days = 30) {
  const from = since(days);
  const totals =
    (db
      .prepare(
        `SELECT COUNT(*) AS calls,
                SUM(success) AS success_calls,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens,
                SUM(total_tokens) AS total_tokens,
                SUM(reasoning_tokens) AS reasoning_tokens,
                SUM(cost) AS cost,
                AVG(latency_ms) AS avg_latency
         FROM usage_records WHERE created_at >= ?`,
      )
      .get(from) as Record<string, unknown> | undefined) ?? {};

  const calls = num(totals.calls);
  const successCalls = num(totals.success_calls);
  const latencies = (
    db
      .prepare('SELECT latency_ms FROM usage_records WHERE created_at >= ? AND success = 1 ORDER BY latency_ms')
      .all(from) as unknown as { latency_ms: number }[]
  ).map((row) => row.latency_ms);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;

  const byModel = (
    db
      .prepare(
        `SELECT provider || '/' || model AS label, COUNT(*) AS calls, SUM(total_tokens) AS tokens,
                SUM(cost) AS cost,
                AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0 END) * 100 AS success_rate,
                AVG(latency_ms) AS avg_latency
         FROM usage_records WHERE created_at >= ?
         GROUP BY provider, model ORDER BY calls DESC`,
      )
      .all(from) as unknown as Record<string, unknown>[]
  ).map(groupRow);

  const byScenario = (
    db
      .prepare(
        `SELECT scenario AS label, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(cost) AS cost,
                AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0 END) * 100 AS success_rate,
                AVG(latency_ms) AS avg_latency
         FROM usage_records WHERE created_at >= ?
         GROUP BY scenario ORDER BY calls DESC`,
      )
      .all(from) as unknown as Record<string, unknown>[]
  ).map(groupRow);

  const bySubject = (
    db
      .prepare(
        `SELECT COALESCE(subject, '未标注') AS label, COUNT(*) AS calls, SUM(total_tokens) AS tokens,
                SUM(cost) AS cost,
                AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0 END) * 100 AS success_rate,
                AVG(latency_ms) AS avg_latency
         FROM usage_records WHERE created_at >= ?
         GROUP BY COALESCE(subject, '未标注') ORDER BY calls DESC`,
      )
      .all(from) as unknown as Record<string, unknown>[]
  ).map(groupRow);

  const settings = getSettings();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthCost = num(
    (
      db
        .prepare('SELECT SUM(cost) AS cost FROM usage_records WHERE created_at >= ?')
        .get(monthStart.getTime()) as { cost: number | null } | undefined
    )?.cost,
  );
  const percent = settings.monthlyBudget > 0 ? Math.min(100, round((monthCost / settings.monthlyBudget) * 100, 1)) : 0;

  return {
    range: { days, from, to: Date.now() },
    currency: 'USD',
    summary: {
      calls,
      successCalls,
      failedCalls: calls - successCalls,
      successRate: calls ? round((successCalls / calls) * 100, 1) : 0,
      promptTokens: num(totals.prompt_tokens),
      completionTokens: num(totals.completion_tokens),
      totalTokens: num(totals.total_tokens),
      reasoningTokens: num(totals.reasoning_tokens),
      cost: round(num(totals.cost), 6),
      avgLatencyMs: round(num(totals.avg_latency), 0),
      p95LatencyMs: p95,
    },
    byModel,
    byScenario,
    bySubject,
    budget: {
      monthlyBudget: settings.monthlyBudget,
      monthCost: round(monthCost, 6),
      percent,
      warning: settings.monthlyBudget > 0 && percent >= 80,
      currency: 'USD',
    },
  };
}

function groupRow(row: Record<string, unknown>): UsageGroupRow {
  return {
    label: String(row.label ?? '未标注'),
    calls: num(row.calls),
    tokens: num(row.tokens),
    cost: round(num(row.cost), 6),
    successRate: round(num(row.success_rate), 1),
    avgLatencyMs: round(num(row.avg_latency), 0),
  };
}

export function usageDaily(days = 30): UsageTimeRow[] {
  return (
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS date,
                COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(cost) AS cost,
                AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0 END) * 100 AS success_rate,
                AVG(latency_ms) AS avg_latency
         FROM usage_records WHERE created_at >= ?
         GROUP BY date ORDER BY date ASC`,
      )
      .all(since(days)) as unknown as Record<string, unknown>[]
  ).map((row) => ({
    date: String(row.date),
    calls: num(row.calls),
    tokens: num(row.tokens),
    cost: round(num(row.cost), 6),
    successRate: round(num(row.success_rate), 1),
    avgLatencyMs: round(num(row.avg_latency), 0),
  }));
}

export function usageCost(days = 30) {
  const summary = usageSummary(days);
  return {
    currency: summary.currency,
    days,
    total: summary.summary.cost,
    byModel: summary.byModel,
    byScenario: summary.byScenario,
    daily: usageDaily(days).map((row) => ({ date: row.date, cost: row.cost, calls: row.calls })),
  };
}

export function usageRecords(days = 30, limit = 500) {
  return db
    .prepare(
      `SELECT usage_id, provider, model, scenario, subject, prompt_tokens, completion_tokens,
              total_tokens, reasoning_tokens, latency_ms, cost, success, error, created_at
       FROM usage_records WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(since(days), limit) as unknown as Record<string, unknown>[];
}