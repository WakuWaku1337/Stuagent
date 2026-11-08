import { Hono } from 'hono';
import { testConnection } from '../learning/llm.ts';
import { resetPiRuntime } from '../pi.ts';
import { findProvider, listProviders, REASONING_LABELS, type ReasoningLevel } from '../settings/providers.ts';
import {
  deleteApiKey,
  getSettings,
  listApiKeys,
  resolveApiKeys,
  saveApiKey,
  updateApiKey,
  updateGeneration,
  updateModel,
  updateReasoning,
} from '../settings/store.ts';
import { requireAdmin } from '../auth/middleware.ts';

const settings = new Hono();
settings.use('*', requireAdmin);

function reasoningValue(value: unknown): ReasoningLevel {
  return value === 'low' || value === 'high' ? value : 'medium';
}

settings.get('/providers', (c) => {
  const current = getSettings();
  return c.json({
    providers: listProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      api: provider.api,
      baseUrl: provider.baseUrl,
      requiresKey: provider.requiresKey,
      note: provider.note ?? null,
      env: Boolean(provider.env),
      models: provider.models,
    })),
    reasoningOptions: REASONING_LABELS,
    current,
  });
});

settings.get('/model', (c) => {
  const current = getSettings();
  const provider = findProvider(current.provider);
  let keyCount = 0;
  try {
    keyCount = resolveApiKeys(current.provider).length;
  } catch {
    keyCount = 0;
  }
  return c.json({
    ...current,
    providerName: provider?.name ?? current.provider,
    requiresKey: provider?.requiresKey ?? true,
    configured: provider ? !provider.requiresKey || keyCount > 0 : false,
    keyCount,
    reasoningOptions: REASONING_LABELS,
  });
});

settings.put('/model', async (c) => {
  const body = await c.req
    .json<{ provider?: string; model?: string; baseUrl?: string; contextLength?: number }>()
    .catch(() => null);
  if (!body?.provider || !body.model) return c.json({ error: 'provider / model 必填' }, 400);
  try {
    const updated = updateModel({
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      contextLength: body.contextLength,
    });
    resetPiRuntime();
    return c.json(updated);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

settings.put('/reasoning', async (c) => {
  const body = await c.req.json<{ reasoning?: string }>().catch(() => null);
  if (!body?.reasoning) return c.json({ error: 'reasoning 必填' }, 400);
  try {
    const updated = updateReasoning(body.reasoning as ReasoningLevel);
    resetPiRuntime();
    return c.json(updated);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

settings.get('/generation', (c) => c.json(getSettings()));

settings.put('/generation', async (c) => {
  const body = await c.req
    .json<{
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      contextLength?: number;
      scenarioParams?: Record<string, { temperature?: number; topP?: number; maxTokens?: number }>;
      monthlyBudget?: number;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: '请求体必须是 JSON' }, 400);
  try {
    const updated = updateGeneration(body);
    resetPiRuntime();
    return c.json(updated);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

settings.get('/keys', (c) => {
  const providerId = c.req.query('provider') ?? getSettings().provider;
  try {
    return c.json({ provider: providerId, keys: listApiKeys(providerId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

settings.put('/apikey', async (c) => {
  const body = await c.req
    .json<{
      action?: 'save' | 'delete';
      provider?: string;
      label?: string;
      apiKey?: string;
      keyId?: string;
      model?: string;
      baseUrl?: string;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: '请求体必须是 JSON' }, 400);
  try {
    if (body.action === 'delete') {
      if (!body.keyId) return c.json({ error: 'keyId 必填' }, 400);
      deleteApiKey(body.keyId);
      resetPiRuntime();
      return c.json({ deleted: body.keyId });
    }
    if (!body.provider || !body.apiKey) return c.json({ error: 'provider / apiKey 必填' }, 400);
    const provider = findProvider(body.provider);
    if (!provider) return c.json({ error: 'Provider 不存在' }, 404);
    const current = getSettings();
    const modelId =
      body.model ??
      (current.provider === provider.id ? current.model : provider.models[0]?.id);
    if (!modelId) return c.json({ error: '请先选择模型' }, 400);
    const baseUrl =
      body.baseUrl ?? (current.provider === provider.id ? current.baseUrl : provider.baseUrl);
    // 保存前做一次最小调用，失败不入库
    await testConnection({
      provider: provider.id,
      model: modelId,
      baseUrl,
      apiKey: body.apiKey,
    });
    const key = body.keyId
      ? updateApiKey(body.keyId, body.label ?? '默认密钥', body.apiKey)
      : saveApiKey(provider.id, body.label ?? '默认密钥', body.apiKey);
    resetPiRuntime();
    return c.json({ key });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 422);
  }
});

settings.post('/test', async (c) => {
  const body = await c.req
    .json<{
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      keyId?: string;
    }>()
    .catch(() => null);
  const current = getSettings();
  const providerId = body?.provider ?? current.provider;
  const provider = findProvider(providerId);
  if (!provider) return c.json({ ok: false, error: 'Provider 不存在' }, 404);
  try {
    const result = await testConnection({
      provider: providerId,
      model: body?.model ?? (current.provider === providerId ? current.model : provider.models[0]?.id),
      baseUrl: body?.baseUrl ?? (current.provider === providerId ? current.baseUrl : provider.baseUrl),
      apiKey: body?.apiKey,
      keyId: body?.keyId,
    });
    return c.json(result);
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      422,
    );
  }
});

export default settings;