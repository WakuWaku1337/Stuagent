export type ProviderApi = 'openai-completions' | 'anthropic-messages';
export type ReasoningLevel = 'low' | 'medium' | 'high';

export interface ProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  inputPrice: number;
  outputPrice: number;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  vision?: boolean;
}

export interface ProviderDef {
  id: string;
  name: string;
  api: ProviderApi;
  baseUrl: string;
  requiresKey: boolean;
  models: ProviderModel[];
  note?: string;
  env?: boolean;
}

function model(
  id: string,
  name: string,
  contextWindow: number,
  maxTokens: number,
  inputPrice = 0,
  outputPrice = 0,
  reasoning = false,
  maxTokensField: ProviderModel['maxTokensField'] = 'max_tokens',
  vision?: boolean,
): ProviderModel {
  return { id, name, reasoning, contextWindow, maxTokens, inputPrice, outputPrice, maxTokensField, vision };
}

const VISION_ID_PATTERN =
  /(gpt-4o|gpt-4\.1|gpt-4-vision|gemini|claude|qwen.*vl|qwen3\.8-flash|vision|llava|pixtral|glm-4v)/i;

export function modelSupportsVision(model: ProviderModel | null | undefined): boolean {
  if (!model) return false;
  if (model.vision !== undefined) return model.vision;
  return VISION_ID_PATTERN.test(model.id);
}

export function findVisionModel(providerId: string): ProviderModel | undefined {
  return findProvider(providerId)?.models.find((item) => modelSupportsVision(item));
}

const STATIC_PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    models: [
      model('gpt-4.1', 'GPT-4.1', 1_047_576, 32_768, 2, 8, false, 'max_tokens', true),
      model('gpt-4.1-mini', 'GPT-4.1 mini', 1_047_576, 32_768, 0.4, 1.6, false, 'max_tokens', true),
      model('gpt-4o', 'GPT-4o', 128_000, 16_384, 2.5, 10, false, 'max_tokens', true),
      model('gpt-4o-mini', 'GPT-4o mini', 128_000, 16_384, 0.15, 0.6, false, 'max_tokens', true),
      model('o3-mini', 'o3-mini', 200_000, 100_000, 1.1, 4.4, true, 'max_completion_tokens'),
      model('o4-mini', 'o4-mini', 200_000, 100_000, 1.1, 4.4, true, 'max_completion_tokens'),
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    models: [
      model('claude-sonnet-4-5', 'Claude Sonnet 4.5', 200_000, 64_000, 3, 15, true, 'max_tokens', true),
      model('claude-haiku-4-5', 'Claude Haiku 4.5', 200_000, 32_000, 0.8, 4, true, 'max_tokens', true),
      model('claude-opus-4-1', 'Claude Opus 4.1', 200_000, 32_000, 15, 75, true, 'max_tokens', true),
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    api: 'openai-completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    models: [
      model('gemini-2.5-pro', 'Gemini 2.5 Pro', 1_048_576, 65_536, 1.25, 10, true, 'max_tokens', true),
      model('gemini-2.5-flash', 'Gemini 2.5 Flash', 1_048_576, 65_536, 0.3, 2.5, true, 'max_tokens', true),
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    models: [
      model('deepseek-chat', 'DeepSeek V3', 128_000, 8_192, 0.27, 1.1),
      model('deepseek-reasoner', 'DeepSeek R1', 128_000, 8_192, 0.55, 2.19, true),
    ],
  },
  {
    id: 'qwen',
    name: '通义千问',
    api: 'openai-completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requiresKey: true,
    models: [
      model('qwen3-max', 'Qwen3 Max', 262_144, 32_768, 1.2, 6, true),
      model('qwen-plus', 'Qwen Plus', 131_072, 16_384, 0.4, 1.2),
      model('qwen3-coder-plus', 'Qwen3 Coder Plus', 1_000_000, 65_536, 1, 5),
      model('qwen-vl-plus', 'Qwen-VL Plus', 131_072, 8_192, 0.8, 2, false, 'max_tokens', true),
      model('qwen-vl-max', 'Qwen-VL Max', 131_072, 8_192, 3, 9, false, 'max_tokens', true),
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    requiresKey: true,
    models: [
      model('glm-4.6', 'GLM-4.6', 200_000, 32_768, 0.6, 2.2, true),
      model('glm-4.5', 'GLM-4.5', 131_072, 16_384, 0.6, 2.2, true),
      model('glm-4.5-air', 'GLM-4.5 Air', 131_072, 16_384, 0.2, 1.1),
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    api: 'openai-completions',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    note: '本地 Ollama 无需 API Key，确认服务已启动且已拉取对应模型。',
    models: [
      model('qwen3:8b', 'Qwen3 8B（本地）', 32_768, 8_192),
      model('llama3.1:8b', 'Llama 3.1 8B（本地）', 131_072, 8_192),
      model('deepseek-r1:8b', 'DeepSeek R1 8B（本地）', 65_536, 8_192, 0, 0, true),
    ],
  },
];

export function envProvider(): ProviderDef | null {
  const baseUrl = process.env.LLM_BASE_URL;
  const modelId = process.env.LLM_MODEL;
  if (!baseUrl || !modelId) return null;
  const visionEnv = process.env.LLM_VISION;
  const vision = visionEnv === '1' ? true : visionEnv === '0' ? false : undefined;
  return {
    id: 'env',
    name: '环境变量（当前 MaaS）',
    api: 'openai-completions',
    baseUrl,
    requiresKey: true,
    env: true,
    note: '来自 server/.env 的 LLM_BASE_URL / LLM_MODEL / LLM_API_KEY，密钥不会在界面中显示。',
    models: [model(modelId, modelId, 131_072, 8_192, 0, 0, false, 'max_tokens', vision)],
  };
}

export function listProviders(): ProviderDef[] {
  const providers = [...STATIC_PROVIDERS];
  const env = envProvider();
  if (env) providers.unshift(env);
  return providers;
}

export function findProvider(id: string): ProviderDef | undefined {
  return listProviders().find((provider) => provider.id === id);
}

export function findModel(providerId: string, modelId: string): ProviderModel | undefined {
  return findProvider(providerId)?.models.find((item) => item.id === modelId);
}

export function modelOrDefault(providerId: string, modelId: string): ProviderModel {
  return (
    findModel(providerId, modelId) ?? {
      id: modelId,
      name: modelId,
      reasoning: false,
      contextWindow: 131_072,
      maxTokens: 4_096,
      inputPrice: 0,
      outputPrice: 0,
    }
  );
}

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  low: '低（节能）',
  medium: '中（均衡）',
  high: '高（深度）',
};