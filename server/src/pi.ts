import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentSession,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { createKnowledgeTool } from './rag/tool.ts';
import type { Citation } from './rag/service.ts';
import { createLearningTools } from './learning/tools.ts';
import { createCoursewareTool } from './courseware/tool.ts';
import { profileContext } from './learning/memory.ts';
import { redactPII } from './security/guard.ts';
import { AGENTS, type AgentId } from './agents/roles.ts';
import { findProvider, modelOrDefault, type ReasoningLevel } from './settings/providers.ts';
import {
  getScenarioParams,
  getSettings,
  keyAvailabilityMessage,
  keyIsCooling,
  markKeyFailure,
  markKeySuccess,
  markKeyUsed,
  resolveApiKeys,
  type ResolvedKey,
} from './settings/store.ts';
import { recordUsage } from './usage/store.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const agentDir = join(serverRoot, 'data', 'pi-agent');
const workspaceRoot = join(serverRoot, 'agent-workspace');

export interface ChatEvent {
  type: 'delta' | 'done' | 'error' | 'citations';
  text?: string;
  message?: string;
  citations?: Citation[];
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

interface Candidate {
  providerId: string;
  keyId: string;
  keyLabel: string;
}

interface RuntimeBundle {
  runtime: ModelRuntime;
  registry: ModelRegistry;
  candidates: Candidate[];
}

let runtimePromise: Promise<RuntimeBundle> | null = null;

const sessions = new Map<string, AgentSession>();
const citationSinks = new Map<string, (c: Citation[]) => void>();
let candidateCursor = 0;

function buildModelEntry(modelId: string) {
  const settings = getSettings();
  const provider = findProvider(settings.provider);
  if (!provider) throw new Error(`Provider 不存在：${settings.provider}`);
  const model = modelOrDefault(provider.id, modelId);
  const params = getScenarioParams('chat');
  return {
    provider,
    model,
    entry: {
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: ['text'],
      contextWindow: Math.min(settings.contextLength || model.contextWindow, model.contextWindow),
      maxTokens: Math.min(params.maxTokens, model.maxTokens),
      cost: {
        input: model.inputPrice,
        output: model.outputPrice,
        cacheRead: 0,
        cacheWrite: 0,
      },
      samplingParams: {
        temperature: params.temperature,
        top_p: params.topP,
      },
    },
  };
}

async function getRuntime(): Promise<RuntimeBundle> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const settings = getSettings();
      const provider = findProvider(settings.provider);
      if (!provider) throw new Error(`Provider 不存在：${settings.provider}`);
      const keys = resolveApiKeys(provider.id);
      if (keys.length === 0) {
        throw new Error(keyAvailabilityMessage(provider.id) || '尚未配置可用的模型密钥');
      }
      const { model, entry } = buildModelEntry(settings.model);
      const baseUrl = (settings.baseUrl || provider.baseUrl).replace(/\/+$/, '');
      await mkdir(agentDir, { recursive: true });

      const providers: Record<string, unknown> = {};
      const candidates: Candidate[] = [];
      keys.forEach((key: ResolvedKey, index) => {
        const providerId = `edupi_${index}`;
        const envName = `EDUPI_RUNTIME_KEY_${index}`;
        process.env[envName] = key.apiKey;
        providers[providerId] = {
          name: `${provider.name}${key.label ? ` · ${key.label}` : ''}`,
          baseUrl,
          apiKey: `$${envName}`,
          api: provider.api,
          models: [entry],
        };
        candidates.push({ providerId, keyId: key.key_id, keyLabel: key.label });
      });

      await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers }, null, 2));
      // 内置 provider 目录会访问境外 CDN，本地离线模式跳过
      process.env.PI_OFFLINE = '1';
      const runtime = await ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: join(agentDir, 'models.json'),
        refreshOnCreate: false,
      });
      const registry = new ModelRegistry(runtime);
      for (const candidate of candidates) {
        if (!registry.find(candidate.providerId, model.id)) {
          throw new Error(
            `models.json 中未找到 ${candidate.providerId}/${model.id}: ${registry.getError() ?? ''}`,
          );
        }
      }
      return { runtime, registry, candidates };
    })();
    runtimePromise.catch(() => {
      runtimePromise = null;
    });
  }
  return runtimePromise;
}

export function resetPiRuntime(): void {
  runtimePromise = null;
  sessions.clear();
  citationSinks.clear();
}

function replaySession(agentId: AgentId, candidate: Candidate, history: ChatHistoryItem[]): SessionManager {
  const cwd = join(workspaceRoot, 'roles', agentId);
  const manager = SessionManager.inMemory(cwd);
  if (history.length === 0) return manager;
  const settings = getSettings();
  const provider = findProvider(settings.provider);
  const { model } = buildModelEntry(settings.model);
  for (const item of history.slice(-24)) {
    const clipped =
      item.content.length > 8000 ? `${item.content.slice(0, 8000)}…` : item.content;
    const content = item.role === 'user' ? redactPII(clipped).text : clipped;
    if (!content.trim()) continue;
    if (item.role === 'user') {
      manager.appendMessage({ role: 'user', content, timestamp: item.created_at });
      continue;
    }
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      api: provider?.api ?? 'openai-completions',
      provider: candidate.providerId,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: item.created_at,
    });
  }
  return manager;
}

async function getSession(
  sessionId: string,
  agentId: AgentId,
  candidate: Candidate,
  reasoning: ReasoningLevel,
  history: ChatHistoryItem[] = [],
): Promise<AgentSession> {
  const key = `${agentId}:${sessionId}:${candidate.providerId}`;
  const existing = sessions.get(key);
  if (existing) return existing;
  const { runtime, registry } = await getRuntime();
  const settings = getSettings();
  const { model } = buildModelEntry(settings.model);
  const selected = registry.find(candidate.providerId, model.id);
  if (!selected) throw new Error('模型未加载');
  const meta = AGENTS[agentId];
  const { session } = await createAgentSession({
    cwd: join(workspaceRoot, 'roles', agentId),
    agentDir,
    modelRuntime: runtime,
    model: selected,
    thinkingLevel: model.reasoning ? reasoning : 'off',
    tools: meta.tools,
    customTools: [
      createKnowledgeTool((citations) => citationSinks.get(key)?.(citations)),
      ...createLearningTools(),
      createCoursewareTool(),
    ],
    sessionManager: replaySession(agentId, candidate, history),
  });
  sessions.set(key, session);
  return session;
}

export function dropConversationSessions(conversationId: string): void {
  for (const key of [...sessions.keys()]) {
    if (key.split(':')[1] === conversationId) sessions.delete(key);
  }
}

export async function getModelInfo() {
  const settings = getSettings();
  const provider = findProvider(settings.provider);
  let keyCount = 0;
  let configured = false;
  try {
    const keys = resolveApiKeys(settings.provider);
    keyCount = keys.length;
    configured = provider ? !provider.requiresKey || keys.length > 0 : false;
  } catch {
    configured = false;
  }
  return {
    provider: settings.provider,
    providerName: provider?.name ?? settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    reasoning: settings.reasoning,
    keyCount,
    configured,
    env: Boolean(provider?.env),
  };
}

function usageFromMessage(message: unknown): {
  input: number;
  output: number;
  total: number;
  reasoning: number;
  cost: number;
} | null {
  const usage = (message as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage) return null;
  const cost = usage.cost as { total?: number } | undefined;
  return {
    input: Number(usage.input ?? 0) || 0,
    output: Number(usage.output ?? 0) || 0,
    total: Number(usage.totalTokens ?? usage.total ?? 0) || 0,
    reasoning: Number(usage.reasoning ?? 0) || 0,
    cost: Number(cost?.total ?? 0) || 0,
  };
}

function inferStatus(message: string): number | null {
  const match = /\b(400|401|403|408|409|429|5\d{2})\b/.exec(message);
  return match ? Number(match[1]) : null;
}

export async function chat(
  sessionId: string,
  message: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
  agentId: AgentId = 'tutor',
  options: { reasoning?: ReasoningLevel; history?: ChatHistoryItem[] } = {},
): Promise<string> {
  const settings = getSettings();
  const provider = findProvider(settings.provider);
  if (!provider) throw new Error('Provider 未配置');
  const { candidates } = await getRuntime();
  const available = candidates.filter((candidate) => !keyIsCooling(candidate.keyId));
  if (available.length === 0) {
    throw new Error(keyAvailabilityMessage(settings.provider) || '全部密钥处于冷却中，请稍后再试');
  }
  const start = candidateCursor % available.length;
  candidateCursor += 1;
  const ordered = [...available.slice(start), ...available.slice(0, start)];
  const reasoning = options.reasoning ?? settings.reasoning;
  const profile = profileContext();
  const promptText = profile ? `【学习者画像】\n${profile}\n\n【学生输入】\n${message}` : message;
  const failures: string[] = [];
  let lastError: Error | null = null;

  for (const candidate of ordered) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const sessionKey = `${agentId}:${sessionId}:${candidate.providerId}`;
    const started = Date.now();
    let fullText = '';
    let errorMessage = '';
    let usageTotals = { input: 0, output: 0, total: 0, reasoning: 0, cost: 0 };
    let emitted = false;

    try {
      const session = await getSession(sessionId, agentId, candidate, reasoning, options.history);
      const sink = (citations: Citation[]) => onEvent({ type: 'citations', citations });
      citationSinks.set(sessionKey, sink);
      markKeyUsed(candidate.keyId);

      const unsubscribe = session.subscribe((event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          fullText += event.assistantMessageEvent.delta;
          emitted = true;
          onEvent({ type: 'delta', text: event.assistantMessageEvent.delta });
        } else if (event.type === 'message_end') {
          const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string };
          if (msg.role === 'assistant') {
            const usage = usageFromMessage(event.message);
            if (usage) {
              usageTotals = {
                input: usageTotals.input + usage.input,
                output: usageTotals.output + usage.output,
                total: usageTotals.total + usage.total,
                reasoning: usageTotals.reasoning + usage.reasoning,
                cost: usageTotals.cost + usage.cost,
              };
            }
            if (msg.stopReason === 'error') {
              errorMessage = msg.errorMessage ?? '模型调用失败';
            }
          }
        }
      });

      const abortHandler = () => session.abort();
      signal?.addEventListener('abort', abortHandler);
      try {
        await session.prompt(promptText);
      } finally {
        unsubscribe();
        citationSinks.delete(sessionKey);
        signal?.removeEventListener('abort', abortHandler);
      }

      if (errorMessage) throw new Error(errorMessage);

      const latencyMs = Date.now() - started;
      recordUsage({
        provider: settings.provider,
        model: settings.model,
        scenario: 'chat',
        promptTokens: usageTotals.input,
        completionTokens: usageTotals.output,
        totalTokens: usageTotals.total,
        reasoningTokens: usageTotals.reasoning,
        latencyMs,
        cost: usageTotals.cost,
        success: true,
        keyId: candidate.keyId,
      });
      markKeySuccess(candidate.keyId);
      onEvent({ type: 'done', text: fullText });
      return fullText;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      const latencyMs = Date.now() - started;
      recordUsage({
        provider: settings.provider,
        model: settings.model,
        scenario: 'chat',
        promptTokens: usageTotals.input,
        completionTokens: usageTotals.output,
        totalTokens: usageTotals.total,
        reasoningTokens: usageTotals.reasoning,
        latencyMs,
        cost: usageTotals.cost,
        success: false,
        error: messageText,
        keyId: candidate.keyId,
      });
      const status = inferStatus(messageText);
      if (
        !aborted &&
        (status === null || status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500)
      ) {
        markKeyFailure(candidate.keyId, status, messageText);
      }
      sessions.delete(sessionKey);
      failures.push(`${candidate.keyLabel || candidate.keyId}: ${messageText}`);
      lastError = error instanceof Error ? error : new Error(messageText);
      if (aborted || emitted) {
        onEvent({ type: 'error', message: messageText });
        throw lastError;
      }
    }
  }

  const detail = failures.length > 1 ? `（已尝试 ${failures.length} 个密钥）` : '';
  const finalError = new Error((lastError?.message ?? '模型调用失败') + detail);
  onEvent({ type: 'error', message: finalError.message });
  throw finalError;
}