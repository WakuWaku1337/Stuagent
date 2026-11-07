import { Hono } from 'hono';
import { usageCost, usageDaily, usageRecords, usageSummary } from '../usage/store.ts';

const usage = new Hono();

function daysFrom(value: string | undefined): number {
  const days = Number(value ?? 30);
  if (!Number.isFinite(days)) return 30;
  return Math.min(365, Math.max(1, Math.round(days)));
}

usage.get('/summary', (c) => c.json(usageSummary(daysFrom(c.req.query('days')))));

usage.get('/daily', (c) => {
  const days = daysFrom(c.req.query('days'));
  return c.json({ days, daily: usageDaily(days) });
});

usage.get('/cost', (c) => c.json(usageCost(daysFrom(c.req.query('days')))));

usage.get('/export', (c) => {
  const days = daysFrom(c.req.query('days'));
  const format = c.req.query('format') === 'json' ? 'json' : 'csv';
  const rows = usageRecords(days);
  if (format === 'json') {
    c.header('Content-Disposition', `attachment; filename="usage-${days}d.json"`);
    return c.json({ exported_at: new Date().toISOString(), days, records: rows });
  }
  const header = [
    'created_at',
    'provider',
    'model',
    'scenario',
    'subject',
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'reasoning_tokens',
    'latency_ms',
    'cost_usd',
    'success',
    'error',
  ];
  const lines = rows.map((row) =>
    [
      new Date(Number(row.created_at)).toISOString(),
      row.provider,
      row.model,
      row.scenario,
      row.subject ?? '',
      row.prompt_tokens,
      row.completion_tokens,
      row.total_tokens,
      row.reasoning_tokens,
      row.latency_ms,
      row.cost,
      row.success ? '1' : '0',
      row.error ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="usage-${days}d.csv"`);
  return c.body([header.join(','), ...lines].join('\n'));
});

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default usage;