import type { ProviderModel, ReasoningLevel } from '../settings/providers.ts';
import { findProvider, modelOrDefault } from '../settings/providers.ts';
import {
  getKeySecret,
  getScenarioParams,
  getSettings,
  keyAvailabilityMessage,
  markKeyFailure,
  markKeySuccess,
  markKeyUsed,
  resolveApiKeys,
  type ResolvedKey,
} from '../settings/store.ts';
import { recordUsage } from '../usage/store.ts';

export type LlmRole = 'system' | 'user' | 'assistant';
export type LlmContent =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface LlmMessage {
  role: LlmRole;
  content: LlmContent;
}

export interface LlmCallOptions {
  messages: LlmMessage[];
  scenario?: string;
  subject?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoning?: ReasoningLevel;
  json?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  keyId?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
}

export interface LlmResult {
  text: string;
  raw: unknown;
  provider: string;
  model: string;
  keyId: string;
  latencyMs: number;
  usage: LlmUsage;
  cost: number;
}

export class LlmRequestError extends Error {
  status: number | null;
  retryable: boolean;

  constructor(message: string, status: number | null = null, retryable = true) {
    super(message);
    this.name = 'LlmRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function estimateCost(model: ProviderModel, usage: LlmUsage): number {
  const cost =
    (usage.promptTokens / 1_000_000) * model.inputPrice +
    (usage.completionTokens / 1_000_000) * model.outputPrice;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function contentChars(content: LlmContent): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 4000), 0);
}

function truncateContent(content: LlmContent, maxChars: number): LlmContent {
  if (typeof content === 'string') return content.slice(0, maxChars);
  let used = 0;
  const parts: typeof content = [];
  for (const part of content) {
    const size = part.type === 'text' ? part.text.length : 4000;
    if (used + size <= maxChars) {
      parts.push(part);
      used += size;
    } else if (part.type === 'text') {
      const left = Math.max(0, maxChars - used);
      if (left > 0) parts.push({ type: 'text', text: part.text.slice(0, left) });
      break;
    } else {
      break;
    }
  }
  return parts;
}

/** 按 context_length 估算并保留系统消息与最近对话 */
export function fitMessages(messages: LlmMessage[], contextLength: number): LlmMessage[] {
  const maxChars = Math.max(4000, contextLength * 3);
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  let used = system.reduce((sum, m) => sum + contentChars(m.content), 0);
  const kept: LlmMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const message = rest[i];
    const size = contentChars(message.content);
    if (used + size <= maxChars) {
      kept.unshift(message);
      used += size;
      continue;
    }
    const left = Math.max(1000, maxChars - used);
    kept.unshift({ ...message, content: truncateContent(message.content, left) });
    break;
  }
  return [...system, ...kept];
}

function toOpenAIMessages(messages: LlmMessage[]) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function extractOpenAIUsage(raw: unknown): LlmUsage {
  const usage = (raw as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0;
  const reasoningTokens =
    Number((usage.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens ?? 0) || 0;
  return { promptTokens, completionTokens, totalTokens, reasoningTokens };
}

function extractAnthropicUsage(raw: unknown): LlmUsage {
  const usage = (raw as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const promptTokens = Number(usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.output_tokens ?? 0) || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    reasoningTokens: 0,
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return `HTTP ${res.status}${text ? `：${text.slice(0, 300)}` : ''}`;
}

function isRetryable(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

async function callOpenAICompatible(input: {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: ProviderModel;
  messages: LlmMessage[];
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoning: ReasoningLevel;
  json: boolean;
  signal: AbortSignal;
}): Promise<{ text: string; raw: unknown; usage: LlmUsage }> {
  const body: Record<string, unknown> = {
    model: input.model.id,
    messages: toOpenAIMessages(input.messages),
    [input.model.maxTokensField ?? 'max_tokens']: input.maxTokens,
  };
  const supportsSampling = !(input.providerId === 'openai' && input.model.reasoning);
  if (supportsSampling) {
    body.temperature = input.temperature;
    body.top_p = input.topP;
  }
  if (input.providerId === 'openai' && input.model.reasoning) {
    body.reasoning_effort = input.reasoning;
  }
  if (input.json) body.response_format = { type: 'json_object' };

  const res = await fetch(`${normalizeBaseUrl(input.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!res.ok) {
    const message = await readError(res);
    throw new LlmRequestError(message, res.status, isRetryable(res.status));
  }
  const raw = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = raw.choices?.[0]?.message?.content ?? '';
  return { text: content, raw, usage: extractOpenAIUsage(raw) };
}

function anthropicContent(content: LlmContent) {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
      if (!match) return null;
      return {
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] },
      };
    })
    .filter(Boolean);
}

async function callAnthropic(input: {
  baseUrl: string;
  apiKey: string;
  model: ProviderModel;
  messages: LlmMessage[];
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoning: ReasoningLevel;
  json: boolean;
  signal: AbortSignal;
}): Promise<{ text: string; raw: unknown; usage: LlmUsage }> {
  const system = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('\n\n');
  const messages = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: anthropicContent(message.content) }));
  const thinkingBudget =
    input.model.reasoning && input.reasoning !== 'low'
      ? input.reasoning === 'high'
        ? 4096
        : 2048
      : input.model.reasoning
        ? 1024
        : 0;
  const body: Record<string, unknown> = {
    model: input.model.id,
    max_tokens: Math.max(input.maxTokens, thinkingBudget + 1024),
    messages,
    ...(thinkingBudget
      ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
      : { temperature: input.temperature, top_p: input.topP }),
    ...(system ? { system: input.json ? `${system}\n\n只输出 JSON，不要 markdown 代码围栏。` : system } : {}),
  };
  const res = await fetch(`${normalizeBaseUrl(input.baseUrl)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!res.ok) {
    const message = await readError(res);
    throw new LlmRequestError(message, res.status, isRetryable(res.status));
  }
  const raw = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (raw.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return { text, raw, usage: extractAnthropicUsage(raw) };
}

async function executeOnce(input: {
  providerId: string;
  providerApi: string;
  baseUrl: string;
  apiKey: string;
  model: ProviderModel;
  messages: LlmMessage[];
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoning: ReasoningLevel;
  json: boolean;
  signal: AbortSignal;
}) {
  const maxTokens = Math.max(1, Math.min(input.maxTokens, input.model.maxTokens));
  if (input.providerApi === 'anthropic-messages') {
    return callAnthropic({ ...input, maxTokens });
  }
  return callOpenAICompatible({ ...input, maxTokens });
}

export async function callLlm(options: LlmCallOptions): Promise<LlmResult> {
  const settings = getSettings();
  const providerId = options.provider ?? settings.provider;
  const provider = findProvider(providerId);
  if (!provider) throw new Error(`Provider 不存在：${providerId}`);
  const modelId = options.model ?? settings.model;
  const model = modelOrDefault(providerId, modelId);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? settings.baseUrl ?? provider.baseUrl);
  const scenario = options.scenario ?? 'chat';
  const scenarioParams = getScenarioParams(scenario);
  const temperature = options.temperature ?? scenarioParams.temperature;
  const topP = options.topP ?? scenarioParams.topP;
  const maxTokens = options.maxTokens ?? scenarioParams.maxTokens;
  const reasoning = options.reasoning ?? settings.reasoning;
  const messages = fitMessages(options.messages, scenarioParams.contextLength);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const keys = resolveApiKeys(providerId, { keyId: options.keyId });
  const usable = keys.filter((key) => options.keyId || !key.cooldownUntil);
  if (usable.length === 0) {
    throw new Error(keyAvailabilityMessage(providerId) || '没有可用的 API Key');
  }

  let lastError: Error | null = null;
  const failures: string[] = [];
  for (const key of usable) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    markKeyUsed(key.key_id);
    const started = Date.now();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    try {
      const result = await executeOnce({
        providerId,
        providerApi: provider.api,
        baseUrl,
        apiKey: key.apiKey,
        model,
        messages,
        temperature,
        topP,
        maxTokens,
        reasoning,
        json: options.json ?? false,
        signal,
      });
      const latencyMs = Date.now() - started;
      const cost = estimateCost(model, result.usage);
      recordUsage({
        provider: providerId,
        model: modelId,
        scenario,
        subject: options.subject,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        reasoningTokens: result.usage.reasoningTokens,
        latencyMs,
        cost,
        success: true,
        keyId: key.key_id,
      });
      markKeySuccess(key.key_id);
      return {
        text: result.text,
        raw: result.raw,
        provider: providerId,
        model: modelId,
        keyId: key.key_id,
        latencyMs,
        usage: result.usage,
        cost,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      const status = error instanceof LlmRequestError ? error.status : null;
      const retryable = error instanceof LlmRequestError ? error.retryable : !aborted;
      const message = aborted ? '请求已取消' : error instanceof Error ? error.message : String(error);
      recordUsage({
        provider: providerId,
        model: modelId,
        scenario,
        subject: options.subject,
        latencyMs,
        success: false,
        error: message,
        keyId: key.key_id,
      });
      if (!aborted && (status === null || isRetryable(status))) {
        markKeyFailure(key.key_id, status, message);
      }
      lastError = error instanceof Error ? error : new Error(message);
      failures.push(`${key.label || key.key_id}: ${message}`);
      if (aborted || !retryable) break;
    }
  }
  const detail = failures.length > 1 ? `（已尝试 ${failures.length} 个密钥：${failures.join('；')}）` : failures[0] ?? '';
  throw lastError ?? new Error(`模型调用失败${detail ? `：${detail}` : ''}`);
}

export interface ChatJsonOptions extends Omit<LlmCallOptions, 'messages' | 'json'> {}

export async function chatJson<T>(messages: LlmMessage[], options: ChatJsonOptions = {}): Promise<T> {
  const result = await callLlm({ ...options, messages, json: true });
  return parseJson<T>(result.text);
}

export function parseJson<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error(`无法解析模型 JSON 输出: ${trimmed.slice(0, 120)}`);
  }
}

export async function testConnection(input: {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  keyId?: string;
}): Promise<{ ok: boolean; latencyMs: number; provider: string; model: string; message: string }> {
  const provider = findProvider(input.provider);
  if (!provider) throw new Error('Provider 不存在');
  const settings = getSettings();
  const modelId = input.model ?? (settings.provider === provider.id ? settings.model : provider.models[0]?.id);
  if (!modelId) throw new Error('请选择模型');
  const model = modelOrDefault(provider.id, modelId);
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? provider.baseUrl);
  let key: ResolvedKey | undefined;
  if (input.apiKey !== undefined && input.apiKey.trim()) {
    key = { key_id: 'test', label: '待保存密钥', apiKey: input.apiKey.trim(), source: 'db', cooldownUntil: null };
  } else if (input.keyId) {
    const resolved = getKeySecret(input.keyId);
    key = {
      key_id: resolved.keyId,
      label: resolved.label,
      apiKey: resolved.apiKey,
      source: resolved.keyId === 'env' ? 'env' : 'db',
      cooldownUntil: null,
    };
  } else {
    const keys = resolveApiKeys(provider.id);
    key = keys.find((item) => !item.cooldownUntil) ?? keys[0];
  }
  if (!key && provider.requiresKey) throw new Error('请先填写 API Key');
  const apiKey = key?.apiKey ?? '';
  const started = Date.now();
  const signal = AbortSignal.timeout(30_000);
  try {
    const result = await executeOnce({
      providerId: provider.id,
      providerApi: provider.api,
      baseUrl,
      apiKey,
      model,
      messages: [{ role: 'user', content: '请只回复 OK' }],
      temperature: 0,
      topP: 1,
      maxTokens: Math.min(16, model.maxTokens),
      reasoning: 'low',
      json: false,
      signal,
    });
    const latencyMs = Date.now() - started;
    if (key && key.key_id !== 'env' && key.key_id !== 'none' && key.key_id !== 'test') {
      markKeySuccess(key.key_id);
    }
    return {
      ok: true,
      latencyMs,
      provider: provider.name,
      model: model.id,
      message: result.text.trim().slice(0, 80) || '连接成功',
    };
  } catch (error) {
    const status = error instanceof LlmRequestError ? error.status : null;
    const message = error instanceof Error ? error.message : String(error);
    if (
      key &&
      key.key_id !== 'env' &&
      key.key_id !== 'none' &&
      key.key_id !== 'test' &&
      (status === null || isRetryable(status))
    ) {
      markKeyFailure(key.key_id, status, message);
    }
    throw new LlmRequestError(`连接失败：${message}`, status, false);
  }
}