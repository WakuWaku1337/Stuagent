import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.ts';
import {
  envProvider,
  findProvider,
  modelOrDefault,
  type ProviderDef,
  type ReasoningLevel,
} from './providers.ts';

export interface ScenarioParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface ModelSettings {
  provider: string;
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

export interface ResolvedKey {
  key_id: string;
  label: string;
  apiKey: string;
  source: 'db' | 'env' | 'none';
  cooldownUntil: number | null;
}

interface SettingsRow {
  id: number;
  provider: string;
  model: string;
  base_url: string;
  reasoning: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  context_length: number;
  scenario_params: string;
  monthly_budget: number;
  updated_at: number;
}

interface KeyRow {
  key_id: string;
  provider: string;
  label: string;
  encrypted_key: string;
  hint: string;
  fail_count: number;
  cooldown_until: number | null;
  last_error: string | null;
  last_used_at: number | null;
  created_at: number;
}

const SCENARIOS = new Set(['chat', 'quiz', 'review', 'courseware', 'vision', 'routing']);
const REASONING = new Set<ReasoningLevel>(['low', 'medium', 'high']);

function rowToSettings(row: SettingsRow): ModelSettings {
  let scenarios: Record<string, ScenarioParams> = {};
  try {
    scenarios = JSON.parse(row.scenario_params || '{}') as Record<string, ScenarioParams>;
  } catch {
    scenarios = {};
  }
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    reasoning: (REASONING.has(row.reasoning as ReasoningLevel) ? row.reasoning : 'medium') as ReasoningLevel,
    temperature: row.temperature,
    topP: row.top_p,
    maxTokens: row.max_tokens,
    contextLength: row.context_length,
    scenarioParams: scenarios,
    monthlyBudget: row.monthly_budget,
    updatedAt: row.updated_at,
  };
}

export function getSettings(): ModelSettings {
  const existing = db.prepare('SELECT * FROM model_settings WHERE id = 1').get() as SettingsRow | undefined;
  if (existing) return rowToSettings(existing);

  const env = envProvider();
  const provider = env ?? findProvider('openai')!;
  const firstModel = provider.models[0];
  const now = Date.now();
  db.prepare(
    `INSERT INTO model_settings
      (id, provider, model, base_url, reasoning, temperature, top_p, max_tokens, context_length, scenario_params, monthly_budget, updated_at)
     VALUES (1, ?, ?, ?, 'medium', 0.5, 0.95, 8192, ?, '{}', 0, ?)`,
  ).run(provider.id, firstModel.id, provider.baseUrl, firstModel.contextWindow, now);
  return getSettings();
}

function touch(): void {
  db.prepare('UPDATE model_settings SET updated_at = ? WHERE id = 1').run(Date.now());
}

export function updateModel(input: {
  provider: string;
  model: string;
  baseUrl?: string;
  contextLength?: number;
}): ModelSettings {
  const provider = findProvider(input.provider);
  if (!provider) throw new Error('Provider 不存在');
  const model = modelOrDefault(input.provider, input.model);
  const current = getSettings();
  const baseUrl = (
    input.baseUrl?.trim() ||
    (current.provider === input.provider ? current.baseUrl : provider.baseUrl) ||
    provider.baseUrl
  ).replace(/\/+$/, '');
  db.prepare(
    `UPDATE model_settings
     SET provider = ?, model = ?, base_url = ?, context_length = ?, updated_at = ?
     WHERE id = 1`,
  ).run(
    input.provider,
    input.model,
    baseUrl,
    input.contextLength && input.contextLength > 0 ? input.contextLength : model.contextWindow,
    Date.now(),
  );
  return getSettings();
}

export function updateReasoning(reasoning: ReasoningLevel): ModelSettings {
  if (!REASONING.has(reasoning)) throw new Error('思考强度必须是 low / medium / high');
  db.prepare('UPDATE model_settings SET reasoning = ?, updated_at = ? WHERE id = 1').run(reasoning, Date.now());
  return getSettings();
}

export function updateGeneration(input: {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  contextLength?: number;
  scenarioParams?: Record<string, ScenarioParams>;
  monthlyBudget?: number;
}): ModelSettings {
  const current = getSettings();
  const temperature = clamp(input.temperature ?? current.temperature, 0, 2);
  const topP = clamp(input.topP ?? current.topP, 0, 1);
  const maxTokens = Math.round(clamp(input.maxTokens ?? current.maxTokens, 1, 200_000));
  const contextLength = Math.round(clamp(input.contextLength ?? current.contextLength, 512, 2_000_000));
  const monthlyBudget = Math.max(0, input.monthlyBudget ?? current.monthlyBudget);
  let scenarioParams = current.scenarioParams;
  if (input.scenarioParams) {
    scenarioParams = {};
    for (const [scenario, raw] of Object.entries(input.scenarioParams)) {
      if (!SCENARIOS.has(scenario)) continue;
      const cleaned: ScenarioParams = {};
      if (Number.isFinite(raw.temperature)) cleaned.temperature = clamp(raw.temperature!, 0, 2);
      if (Number.isFinite(raw.topP)) cleaned.topP = clamp(raw.topP!, 0, 1);
      if (Number.isFinite(raw.maxTokens)) cleaned.maxTokens = Math.round(clamp(raw.maxTokens!, 1, 200_000));
      if (Object.keys(cleaned).length > 0) scenarioParams[scenario] = cleaned;
    }
  }
  db.prepare(
    `UPDATE model_settings
     SET temperature = ?, top_p = ?, max_tokens = ?, context_length = ?, scenario_params = ?, monthly_budget = ?, updated_at = ?
     WHERE id = 1`,
  ).run(
    temperature,
    topP,
    maxTokens,
    contextLength,
    JSON.stringify(scenarioParams),
    monthlyBudget,
    Date.now(),
  );
  return getSettings();
}

export function getScenarioParams(scenario: string): Required<ScenarioParams> & { contextLength: number } {
  const settings = getSettings();
  const override = settings.scenarioParams[scenario] ?? {};
  return {
    temperature: override.temperature ?? settings.temperature,
    topP: override.topP ?? settings.topP,
    maxTokens: override.maxTokens ?? settings.maxTokens,
    contextLength: settings.contextLength,
  };
}

export function getProvider(): ProviderDef {
  const settings = getSettings();
  return findProvider(settings.provider) ?? findProvider('openai')!;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function keyInfo(row: KeyRow): ApiKeyInfo {
  const now = Date.now();
  const cooling = Boolean(row.cooldown_until && row.cooldown_until > now);
  return {
    key_id: row.key_id,
    provider: row.provider,
    label: row.label,
    masked: row.hint,
    source: 'db',
    status: cooling ? 'cooling' : 'active',
    fail_count: row.fail_count,
    cooldown_until: row.cooldown_until,
    last_error: row.last_error,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

function envKeyInfo(provider: ProviderDef): ApiKeyInfo {
  const secret = process.env.LLM_API_KEY ?? '';
  return {
    key_id: 'env',
    provider: provider.id,
    label: '环境变量 LLM_API_KEY',
    masked: secret ? maskSecret(secret) : '未配置',
    source: 'env',
    status: secret ? 'active' : 'missing',
    fail_count: 0,
    cooldown_until: null,
    last_error: null,
    last_used_at: null,
    created_at: 0,
  };
}

export function listApiKeys(providerId: string): ApiKeyInfo[] {
  const provider = findProvider(providerId);
  if (!provider) throw new Error('Provider 不存在');
  if (provider.id === 'env') {
    const rows = db
      .prepare('SELECT * FROM provider_keys WHERE provider = ? ORDER BY created_at DESC')
      .all(provider.id) as unknown as KeyRow[];
    return [envKeyInfo(provider), ...rows.map(keyInfo)];
  }
  if (!provider.requiresKey) {
    return [
      {
        key_id: 'none',
        provider: provider.id,
        label: '本地模型（无需 Key）',
        masked: '—',
        source: 'none',
        status: 'active',
        fail_count: 0,
        cooldown_until: null,
        last_error: null,
        last_used_at: null,
        created_at: 0,
      },
    ];
  }
  const rows = db
    .prepare('SELECT * FROM provider_keys WHERE provider = ? ORDER BY created_at DESC')
    .all(provider.id) as unknown as KeyRow[];
  return rows.map(keyInfo);
}

export function saveApiKey(providerId: string, label: string, apiKey: string): ApiKeyInfo {
  const provider = findProvider(providerId);
  if (!provider) throw new Error('Provider 不存在');
  const secret = apiKey.trim();
  if (!secret) throw new Error('API Key 不能为空');
  const created = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO provider_keys (key_id, provider, label, encrypted_key, hint, fail_count, cooldown_until, last_error, last_used_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)`,
  ).run(id, provider.id, label.trim() || '未命名密钥', encryptSecret(secret), maskSecret(secret), created);
  const row = db.prepare('SELECT * FROM provider_keys WHERE key_id = ?').get(id) as unknown as KeyRow;
  return keyInfo(row);
}

export function updateApiKey(keyId: string, label: string, apiKey: string): ApiKeyInfo {
  if (keyId === 'env' || keyId === 'none') throw new Error('该密钥不可更新');
  const secret = apiKey.trim();
  if (!secret) throw new Error('API Key 不能为空');
  const existing = db.prepare('SELECT key_id FROM provider_keys WHERE key_id = ?').get(keyId);
  if (!existing) throw new Error('密钥不存在');
  db.prepare(
    `UPDATE provider_keys
     SET label = ?, encrypted_key = ?, hint = ?, fail_count = 0, cooldown_until = NULL, last_error = NULL
     WHERE key_id = ?`,
  ).run(label.trim() || '未命名密钥', encryptSecret(secret), maskSecret(secret), keyId);
  const row = db.prepare('SELECT * FROM provider_keys WHERE key_id = ?').get(keyId) as unknown as KeyRow;
  return keyInfo(row);
}

export function deleteApiKey(keyId: string): void {
  if (keyId === 'env' || keyId === 'none') throw new Error('该密钥不可删除');
  db.prepare('DELETE FROM provider_keys WHERE key_id = ?').run(keyId);
}

function rawKey(keyId: string): { row: KeyRow; apiKey: string } {
  const row = db.prepare('SELECT * FROM provider_keys WHERE key_id = ?').get(keyId) as unknown as KeyRow | undefined;
  if (!row) throw new Error('密钥不存在');
  return { row, apiKey: decryptSecret(row.encrypted_key) };
}

export function getKeySecret(keyId: string): { keyId: string; label: string; apiKey: string } {
  if (keyId === 'env') {
    const secret = process.env.LLM_API_KEY;
    if (!secret) throw new Error('环境变量 LLM_API_KEY 未配置');
    return { keyId: 'env', label: '环境变量', apiKey: secret };
  }
  if (keyId === 'none') return { keyId: 'none', label: '本地模型', apiKey: '' };
  const { row, apiKey } = rawKey(keyId);
  return { keyId: row.key_id, label: row.label, apiKey };
}

export function resolveApiKeys(providerId: string, options: { keyId?: string } = {}): ResolvedKey[] {
  const provider = findProvider(providerId);
  if (!provider) throw new Error('Provider 不存在');
  if (!provider.requiresKey) {
    return [{ key_id: 'none', label: '本地模型', apiKey: '', source: 'none', cooldownUntil: null }];
  }
  if (options.keyId) {
    const picked = getKeySecret(options.keyId);
    return [{ key_id: picked.keyId, label: picked.label, apiKey: picked.apiKey, source: options.keyId === 'env' ? 'env' : 'db', cooldownUntil: null }];
  }
  if (provider.id === 'env') {
    const now = Date.now();
    const rows = db
      .prepare(
        `SELECT * FROM provider_keys
         WHERE provider = 'env'
         ORDER BY CASE WHEN last_used_at IS NULL THEN 0 ELSE last_used_at END ASC, created_at ASC`,
      )
      .all() as unknown as KeyRow[];
    const keys: ResolvedKey[] = rows.map((row) => ({
      key_id: row.key_id,
      label: row.label,
      apiKey: decryptSecret(row.encrypted_key),
      source: 'db' as const,
      cooldownUntil: row.cooldown_until && row.cooldown_until > now ? row.cooldown_until : null,
    }));
    const secret = process.env.LLM_API_KEY;
    if (secret) {
      keys.push({ key_id: 'env', label: '环境变量', apiKey: secret, source: 'env', cooldownUntil: null });
    }
    return keys;
  }
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT * FROM provider_keys
       WHERE provider = ?
       ORDER BY CASE WHEN last_used_at IS NULL THEN 0 ELSE last_used_at END ASC, created_at ASC`,
    )
    .all(provider.id) as unknown as KeyRow[];
  return rows.map((row) => ({
    key_id: row.key_id,
    label: row.label,
    apiKey: decryptSecret(row.encrypted_key),
    source: 'db' as const,
    cooldownUntil: row.cooldown_until && row.cooldown_until > now ? row.cooldown_until : null,
  }));
}

export function markKeyUsed(keyId: string): void {
  if (keyId === 'env' || keyId === 'none') return;
  db.prepare('UPDATE provider_keys SET last_used_at = ? WHERE key_id = ?').run(Date.now(), keyId);
}

export function keyIsCooling(keyId: string): boolean {
  if (keyId === 'env' || keyId === 'none') return false;
  const row = db.prepare('SELECT cooldown_until FROM provider_keys WHERE key_id = ?').get(keyId) as
    | { cooldown_until: number | null }
    | undefined;
  return Boolean(row?.cooldown_until && row.cooldown_until > Date.now());
}

export function markKeySuccess(keyId: string): void {
  if (keyId === 'env' || keyId === 'none') return;
  db.prepare(
    'UPDATE provider_keys SET fail_count = 0, cooldown_until = NULL, last_error = NULL, last_used_at = ? WHERE key_id = ?',
  ).run(Date.now(), keyId);
}

export function markKeyFailure(keyId: string, statusCode: number | null, message: string): void {
  if (keyId === 'env' || keyId === 'none') return;
  const row = db.prepare('SELECT * FROM provider_keys WHERE key_id = ?').get(keyId) as unknown as KeyRow | undefined;
  if (!row) return;
  const failCount = row.fail_count + 1;
  const cooldownMs =
    statusCode === 401 || statusCode === 403
      ? 15 * 60_000
      : statusCode === 429
        ? Math.min(10 * 60_000, 60_000 * failCount)
        : statusCode && statusCode >= 500
          ? Math.min(5 * 60_000, 30_000 * failCount)
          : 60_000;
  db.prepare(
    'UPDATE provider_keys SET fail_count = ?, cooldown_until = ?, last_error = ? WHERE key_id = ?',
  ).run(failCount, Date.now() + cooldownMs, message.slice(0, 500), keyId);
}

export function keyAvailabilityMessage(providerId: string): string {
  const provider = findProvider(providerId);
  if (!provider?.requiresKey) return '';
  const keys = resolveApiKeys(providerId);
  if (keys.length > 0) return '';
  if (provider.id === 'env') return '环境变量 LLM_API_KEY 未配置';
  const rows = db
    .prepare('SELECT cooldown_until FROM provider_keys WHERE provider = ?')
    .all(providerId) as unknown as { cooldown_until: number | null }[];
  if (rows.length === 0) return '尚未配置 API Key';
  const next = rows
    .map((row) => row.cooldown_until ?? 0)
    .filter((value) => value > Date.now())
    .sort((a, b) => a - b)[0];
  return next ? `全部密钥处于冷却，最早 ${new Date(next).toLocaleTimeString('zh-CN')} 恢复` : '没有可用密钥';
}

export { touch as touchSettings };