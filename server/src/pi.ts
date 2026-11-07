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
import { AGENTS, type AgentId } from './agents/roles.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const agentDir = join(serverRoot, 'data', 'pi-agent');
const workspaceRoot = join(serverRoot, 'agent-workspace');

export interface ChatEvent {
  type: 'delta' | 'done' | 'error' | 'citations';
  text?: string;
  message?: string;
  citations?: Citation[];
}

let runtimePromise: Promise<{ runtime: ModelRuntime; registry: ModelRegistry }> | null = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const baseUrl = process.env.LLM_BASE_URL;
      const modelId = process.env.LLM_MODEL;
      if (!baseUrl || !modelId || !process.env.LLM_API_KEY) {
        throw new Error('缺少 LLM_BASE_URL / LLM_MODEL / LLM_API_KEY，请在 server/.env 配置');
      }
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'models.json'),
        JSON.stringify(
          {
            providers: {
              edupi: {
                name: 'EduPi LLM',
                baseUrl,
                apiKey: '$LLM_API_KEY',
                api: 'openai-completions',
                models: [
                  {
                    id: modelId,
                    name: modelId,
                    reasoning: false,
                    input: ['text'],
                    contextWindow: 131072,
                    maxTokens: 8192,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
      );
      // 内置 provider 目录会访问境外 CDN，本地离线模式跳过
      process.env.PI_OFFLINE = '1';
      const runtime = await ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: join(agentDir, 'models.json'),
        refreshOnCreate: false,
      });
      const registry = new ModelRegistry(runtime);
      const model = registry.find('edupi', modelId);
      if (!model) throw new Error(`models.json 中未找到 edupi/${modelId}: ${registry.getError() ?? ''}`);
      return { runtime, registry };
    })();
    runtimePromise.catch(() => {
      runtimePromise = null;
    });
  }
  return runtimePromise;
}

const sessions = new Map<string, AgentSession>();
const citationSinks = new Map<string, (c: Citation[]) => void>();

async function getSession(sessionId: string, agentId: AgentId): Promise<AgentSession> {
  const key = `${agentId}:${sessionId}`;
  const existing = sessions.get(key);
  if (existing) return existing;
  const { runtime } = await getRuntime();
  const model = new ModelRegistry(runtime).find('edupi', process.env.LLM_MODEL!)!;
  const meta = AGENTS[agentId];
  const { session } = await createAgentSession({
    cwd: join(workspaceRoot, 'roles', agentId),
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    tools: meta.tools,
    customTools: [
      createKnowledgeTool((citations) => citationSinks.get(key)?.(citations)),
      ...createLearningTools(),
      createCoursewareTool(),
    ],
    sessionManager: SessionManager.inMemory(),
  });
  sessions.set(key, session);
  return session;
}

export async function getModelInfo() {
  const { registry } = await getRuntime();
  const model = registry.find('edupi', process.env.LLM_MODEL!);
  const auth = model ? await registry.getApiKeyAndHeaders(model) : undefined;
  return {
    provider: 'edupi',
    model: model?.id ?? process.env.LLM_MODEL,
    baseUrl: process.env.LLM_BASE_URL,
    configured: Boolean(model && auth?.ok),
  };
}

export async function chat(
  sessionId: string,
  message: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
  agentId: AgentId = 'tutor',
): Promise<string> {
  const session = await getSession(sessionId, agentId);
  const sinkKey = `${agentId}:${sessionId}`;
  let fullText = '';
  let errorMessage = '';

  const sink = (citations: Citation[]) => onEvent({ type: 'citations', citations });
  citationSinks.set(sinkKey, sink);

  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      fullText += event.assistantMessageEvent.delta;
      onEvent({ type: 'delta', text: event.assistantMessageEvent.delta });
    } else if (event.type === 'message_end') {
      const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string; content?: unknown };
      if (msg.role === 'assistant' && msg.stopReason === 'error') {
        errorMessage = msg.errorMessage ?? '模型调用失败';
      }
    }
  });

  const abortHandler = () => session.abort();
  signal?.addEventListener('abort', abortHandler);
  const profile = profileContext();
  const promptText = profile ? `【学习者画像】\n${profile}\n\n【学生输入】\n${message}` : message;
  try {
    await session.prompt(promptText);
  } finally {
    unsubscribe();
    citationSinks.delete(sinkKey);
    signal?.removeEventListener('abort', abortHandler);
  }

  if (errorMessage) {
    onEvent({ type: 'error', message: errorMessage });
    throw new Error(errorMessage);
  }
  onEvent({ type: 'done', text: fullText });
  return fullText;
}