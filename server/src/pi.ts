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
import { createMcpTools } from './mcp/service.ts';
import { profileContext } from './learning/memory.ts';
import { redactPII } from './security/guard.ts';
import { AGENTS, type AgentId } from './agents/roles.ts';
import {
  MAX_CONTINUATIONS,
  continuationPrompt,
  looksIncomplete,
  mergeContinuation,
} from './chat/integrity.ts';
import { findProvider, modelOrDefault, modelSupportsVision, type ReasoningLevel } from './settings/providers.ts';
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
import {
  AGENT_MAX_TOOL_STEPS,
  AGENT_TOKEN_BUDGET,
  AGENT_WALL_CLOCK_MS,
  HISTORY_ITEM_MAX_CHARS,
  LLM_KEY_MAX_ATTEMPTS,
  historyReplayLimit,
} from './config.ts';
import { currentTraceId } from './trace.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dataRoot = process.env.EDU_DATA_DIR?.trim()
  ? resolve(process.env.EDU_DATA_DIR)
  : join(serverRoot, 'data');
const agentDir = join(dataRoot, 'pi-agent');
const workspaceRoot = join(serverRoot, 'agent-workspace');

export interface ChatEvent {
  type: 'delta' | 'done' | 'error' | 'citations' | 'continuation' | 'incomplete' | 'thinking';
  text?: string;
  message?: string;
  citations?: Citation[];
  attempt?: number;
  reasoning_tokens?: number;
}

export interface ChatImage {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  images?: ChatImage[];
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
      input: modelSupportsVision(model) ? ['text', 'image'] : ['text'],
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
  for (const item of history.slice(-historyReplayLimit())) {
    const clipped =
      item.content.length > HISTORY_ITEM_MAX_CHARS
        ? `${item.content.slice(0, HISTORY_ITEM_MAX_CHARS)}…`
        : item.content;
    const content = item.role === 'user' ? redactPII(clipped).text : clipped;
    if (!content.trim() && !item.images?.length) continue;
    if (item.role === 'user') {
      const parts: ({ type: 'text'; text: string } | ChatImage)[] = [];
      if (content.trim()) parts.push({ type: 'text', text: content });
      if (item.images?.length) parts.push(...item.images);
      manager.appendMessage({
        role: 'user',
        content: parts.length > 0 ? parts : content,
        timestamp: item.created_at,
      });
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
      ...(await createMcpTools()),
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
  const model = modelOrDefault(settings.provider, settings.model);
  const vision = modelSupportsVision(model);
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
    vision,
    image_mode: vision
      ? 'vision'
      : process.env.LLM_OCR_MODEL || provider?.models.some((item) => modelSupportsVision(item))
        ? 'ocr'
        : 'none',
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

function limitMessage(reason: 'wall_clock' | 'token_budget' | 'tool_steps'): string {
  if (reason === 'token_budget') {
    return `已达到 token 预算（${AGENT_TOKEN_BUDGET}），已停止生成，可人工接管继续`;
  }
  if (reason === 'tool_steps') {
    return `已达到工具调用步数上限（${AGENT_MAX_TOOL_STEPS}），已停止生成，可人工接管继续`;
  }
  return `已达到单次会话墙钟上限（${Math.round(AGENT_WALL_CLOCK_MS / 1000)}s），已停止生成，可人工接管继续`;
}

export async function chat(
  sessionId: string,
  message: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
  agentId: AgentId = 'tutor',
  options: { reasoning?: ReasoningLevel; history?: ChatHistoryItem[]; images?: ChatImage[] } = {},
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
  const rotated = [...available.slice(start), ...available.slice(0, start)];
  // 先轮换起点，再按配置截断，避免主对话一次耗尽全部密钥
  const ordered = rotated.slice(0, LLM_KEY_MAX_ATTEMPTS);
  const reasoning = options.reasoning ?? settings.reasoning;
  const profile = profileContext();
  const promptText = profile ? `【学习者画像】\n${profile}\n\n【学生输入】\n${message}` : message;
  const failures: string[] = [];
  let lastError: Error | null = null;
  const traceId = currentTraceId();
  const timeoutSignal = AGENT_WALL_CLOCK_MS > 0 ? AbortSignal.timeout(AGENT_WALL_CLOCK_MS) : null;
  const effectiveSignal = timeoutSignal
    ? signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal
    : signal;

  for (const candidate of ordered) {
    if (effectiveSignal?.aborted) throw new DOMException('已取消', 'AbortError');
    const sessionKey = `${agentId}:${sessionId}:${candidate.providerId}`;
    const started = Date.now();
    let fullText = '';
    let errorMessage = '';
    let usageTotals = { input: 0, output: 0, total: 0, reasoning: 0, cost: 0 };
    let emitted = false;
    let stopReason = '';
    let continuing = false;
    let continuationText = '';
    let lastThinkingAt = 0;
    let limitHit: 'wall_clock' | 'token_budget' | 'tool_steps' | null = null;
    let toolSteps = 0;

    try {
      const session = await getSession(sessionId, agentId, candidate, reasoning, options.history);
      const sink = (citations: Citation[]) => onEvent({ type: 'citations', citations });
      citationSinks.set(sessionKey, sink);
      markKeyUsed(candidate.keyId);

      const unsubscribe = session.subscribe((event) => {
        if (event.type === 'tool_execution_start') {
          toolSteps += 1;
          if (AGENT_MAX_TOOL_STEPS > 0 && toolSteps >= AGENT_MAX_TOOL_STEPS && !limitHit) {
            limitHit = 'tool_steps';
            session.abort();
          }
          return;
        }
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
          const now = Date.now();
          if (now - lastThinkingAt > 800) {
            lastThinkingAt = now;
            onEvent({ type: 'thinking' });
          }
          return;
        }
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          const delta = event.assistantMessageEvent.delta;
          if (continuing) {
            continuationText += delta;
          } else {
            fullText += delta;
            emitted = true;
            onEvent({ type: 'delta', text: delta });
          }
        } else if (event.type === 'message_end') {
          const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string };
          if (msg.role === 'assistant') {
            stopReason = msg.stopReason ?? '';
            const usage = usageFromMessage(event.message);
            if (usage) {
              usageTotals = {
                input: usageTotals.input + usage.input,
                output: usageTotals.output + usage.output,
                total: usageTotals.total + usage.total,
                reasoning: usageTotals.reasoning + usage.reasoning,
                cost: usageTotals.cost + usage.cost,
              };
              if (AGENT_TOKEN_BUDGET > 0 && usageTotals.total >= AGENT_TOKEN_BUDGET && !limitHit) {
                limitHit = 'token_budget';
                session.abort();
              }
            }
            if (msg.stopReason === 'error') {
              errorMessage = msg.errorMessage ?? '模型调用失败';
            }
          }
        }
      });

      const abortHandler = () => session.abort();
      effectiveSignal?.addEventListener('abort', abortHandler);
      let attempts = 0;
      try {
        try {
          await session.prompt(promptText, options.images?.length ? { images: options.images } : undefined);
          // 等 session 完全空闲，避免续写提示与尾部分片并发
          await session.waitForIdle();
        } catch (error) {
          const capped = limitHit !== null || (timeoutSignal?.aborted === true && signal?.aborted !== true);
          if (!capped) throw error;
        }

        while (
          !effectiveSignal?.aborted &&
          attempts < MAX_CONTINUATIONS &&
          (stopReason === 'length' || (fullText.length > 400 && looksIncomplete(fullText)))
        ) {
          attempts += 1;
          onEvent({ type: 'continuation', attempt: attempts });
          continuing = true;
          continuationText = '';
          stopReason = '';
          let continuationFailed = false;
          for (let retry = 0; retry < 2 && !effectiveSignal?.aborted; retry += 1) {
            try {
              await session.prompt(continuationPrompt(fullText, attempts));
              continuationFailed = false;
              break;
            } catch {
              continuationFailed = true;
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
          continuing = false;
          await session.waitForIdle();
          const merged = mergeContinuation(fullText, continuationText);
          const addition = merged.slice(fullText.length);
          if (addition) {
            fullText = merged;
            emitted = true;
            onEvent({ type: 'delta', text: addition });
          }
          if (continuationFailed || !addition) break;
        }
        if (!limitHit && timeoutSignal?.aborted && signal?.aborted !== true) {
          limitHit = 'wall_clock';
        }
        if (limitHit) {
          onEvent({ type: 'incomplete', message: limitMessage(limitHit), attempt: attempts });
        } else if (stopReason === 'length' || (fullText.length > 400 && looksIncomplete(fullText))) {
          onEvent({
            type: 'incomplete',
            message: '输出可能被截断，可点击“继续生成”或“重新生成”',
            attempt: attempts,
          });
        }
      } finally {
        unsubscribe();
        citationSinks.delete(sessionKey);
        effectiveSignal?.removeEventListener('abort', abortHandler);
      }

      if (errorMessage) throw new Error(errorMessage);
      if (limitHit && !fullText.trim()) {
        // 带上限标记的空回复视为中止，避免把预算/步数上限误记为密钥故障
        throw new DOMException(limitMessage(limitHit), 'AbortError');
      }

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
        traceId: traceId || undefined,
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
        traceId: traceId || undefined,
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