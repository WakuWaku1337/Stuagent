<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  CircleCheck,
  Connection,
  Cpu,
  Delete,
  Key,
  Lock,
  Plus,
  Refresh,
  Setting,
} from '@element-plus/icons-vue';
import {
  api,
  type ApiKeyInfo,
  type ConnectionTestResult,
  type ModelSettingsInfo,
  type ProviderOption,
  type ReasoningLevel,
} from '../api/data';

interface ScenarioRow {
  key: string;
  label: string;
  note: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

const scenarioMeta = [
  { key: 'chat', label: '答疑对话', note: '主讲 / 解题' },
  { key: 'quiz', label: '出题与题库', note: '出题 / 提取' },
  { key: 'review', label: '考试复盘', note: '识别 / 报告' },
  { key: 'courseware', label: '交互课件', note: 'HTML 生成' },
];

const loading = ref(true);
const savingModel = ref(false);
const savingGeneration = ref(false);
const testing = ref(false);
const savingKey = ref(false);
const testingKeyId = ref('');
const errorMessage = ref('');
const testResult = ref<(ConnectionTestResult & { success: boolean }) | null>(null);
const keyTestMessage = ref('');

const providers = ref<ProviderOption[]>([]);
const current = ref<ModelSettingsInfo | null>(null);
const keys = ref<ApiKeyInfo[]>([]);

const selectedProvider = ref('');
const selectedModel = ref('');
const baseUrl = ref('');
const reasoning = ref<ReasoningLevel>('medium');

const generation = ref({
  temperature: 0.5,
  topP: 0.95,
  maxTokens: 8192,
  contextLength: 131072,
  monthlyBudget: 0,
});
const scenarioRows = ref<ScenarioRow[]>([]);
const keyForm = ref({ label: '', apiKey: '' });
const editingKeyId = ref('');

const providerDef = computed(() => providers.value.find((p) => p.id === selectedProvider.value));
const modelOptions = computed(() => providerDef.value?.models ?? []);
const selectedModelDef = computed(() =>
  modelOptions.value.find((m) => m.id === selectedModel.value),
);
const requiresKey = computed(() => providerDef.value?.requiresKey ?? true);
const keyList = computed(() => keys.value);
const hasEnvKey = computed(() => keyList.value.some((key) => key.source === 'env'));
const activeKeyCount = computed(() => keyList.value.filter((key) => key.status === 'active').length);
const currentModelLabel = computed(() =>
  current.value ? `${current.value.providerName} · ${current.value.model}` : '尚未配置',
);
const reasoningText = computed(
  () => ({ low: '低（节能）', medium: '中（均衡）', high: '高（深度）' })[reasoning.value],
);

async function load(showMessage = false) {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [catalog, model] = await Promise.all([
      api.settingsProviders(),
      api.settingsModel(),
    ]);
    providers.value = catalog.providers;
    current.value = model;
    applySettings(model);
    await loadKeys(model.provider);
    if (showMessage) ElMessage.success('设置已刷新');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function applySettings(model: ModelSettingsInfo) {
  selectedProvider.value = model.provider;
  selectedModel.value = model.model;
  baseUrl.value = model.baseUrl;
  reasoning.value = model.reasoning;
  generation.value = {
    temperature: model.temperature,
    topP: model.topP,
    maxTokens: model.maxTokens,
    contextLength: model.contextLength,
    monthlyBudget: model.monthlyBudget,
  };
  scenarioRows.value = scenarioMeta.map((meta) => {
    const params = model.scenarioParams[meta.key] ?? {};
    return {
      ...meta,
      temperature: params.temperature,
      topP: params.topP,
      maxTokens: params.maxTokens,
    };
  });
}

async function loadKeys(providerId: string) {
  if (!providerId) {
    keys.value = [];
    return;
  }
  try {
    const data = await api.settingsKeys(providerId);
    keys.value = data.keys;
  } catch (error) {
    keys.value = [];
    keyTestMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function onProviderChange(providerId: string) {
  const provider = providers.value.find((p) => p.id === providerId);
  selectedModel.value = provider?.models[0]?.id ?? '';
  baseUrl.value = provider?.baseUrl ?? '';
  testResult.value = null;
  keyForm.value = { label: '', apiKey: '' };
  editingKeyId.value = '';
  keyTestMessage.value = '';
  await loadKeys(providerId);
}

async function saveModel() {
  if (!selectedProvider.value || !selectedModel.value) {
    ElMessage.warning('请选择 Provider 与模型');
    return;
  }
  savingModel.value = true;
  testResult.value = null;
  try {
    await api.updateModelSettings({
      provider: selectedProvider.value,
      model: selectedModel.value,
      baseUrl: baseUrl.value,
    });
    await api.updateReasoning(reasoning.value);
    current.value = await api.settingsModel();
    ElMessage.success('模型与思考强度已保存');
    await loadKeys(selectedProvider.value);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingModel.value = false;
  }
}

async function testCurrent() {
  if (!selectedProvider.value || !selectedModel.value) {
    ElMessage.warning('请先选择 Provider 与模型');
    return;
  }
  testing.value = true;
  testResult.value = null;
  try {
    const result = await api.testConnection({
      provider: selectedProvider.value,
      model: selectedModel.value,
      baseUrl: baseUrl.value,
    });
    testResult.value = { ...result, success: true };
    ElMessage.success(`连接成功，延迟 ${result.latencyMs}ms`);
  } catch (error) {
    testResult.value = {
      success: false,
      ok: false,
      latencyMs: 0,
      provider: providerDef.value?.name ?? selectedProvider.value,
      model: selectedModel.value,
      message: error instanceof Error ? error.message : String(error),
    };
    ElMessage.error(testResult.value.message);
  } finally {
    testing.value = false;
  }
}

async function saveReasoningOnly() {
  try {
    await api.updateReasoning(reasoning.value);
    current.value = await api.settingsModel();
    ElMessage.success('思考强度已更新');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function saveGeneration() {
  savingGeneration.value = true;
  try {
    const overrides: Record<string, { temperature?: number; topP?: number; maxTokens?: number }> = {};
    for (const row of scenarioRows.value) {
      const item: { temperature?: number; topP?: number; maxTokens?: number } = {};
      if (typeof row.temperature === 'number') item.temperature = row.temperature;
      if (typeof row.topP === 'number') item.topP = row.topP;
      if (typeof row.maxTokens === 'number') item.maxTokens = row.maxTokens;
      if (Object.keys(item).length > 0) overrides[row.key] = item;
    }
    await api.updateGeneration({
      ...generation.value,
      scenarioParams: overrides,
    });
    current.value = await api.settingsModel();
    ElMessage.success('生成参数已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingGeneration.value = false;
  }
}

function clearScenario(row: ScenarioRow) {
  row.temperature = undefined;
  row.topP = undefined;
  row.maxTokens = undefined;
}

async function addKey() {
  if (!selectedProvider.value) return;
  if (!keyForm.value.apiKey.trim()) {
    ElMessage.warning('请填写 API Key');
    return;
  }
  savingKey.value = true;
  keyTestMessage.value = '';
  try {
    await api.saveApiKey({
      provider: selectedProvider.value,
      label: keyForm.value.label.trim() || `密钥 ${keys.value.filter((k) => k.source === 'db').length + 1}`,
      apiKey: keyForm.value.apiKey.trim(),
      model: selectedModel.value,
      baseUrl: baseUrl.value,
      ...(editingKeyId.value ? { keyId: editingKeyId.value } : {}),
    });
    ElMessage.success(editingKeyId.value ? '密钥已更新并通过校验' : '密钥校验通过并已加密保存');
    keyForm.value = { label: '', apiKey: '' };
    editingKeyId.value = '';
    await loadKeys(selectedProvider.value);
    current.value = await api.settingsModel();
  } catch (error) {
    keyTestMessage.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(keyTestMessage.value);
  } finally {
    savingKey.value = false;
  }
}

function editKey(key: ApiKeyInfo) {
  editingKeyId.value = key.key_id;
  keyForm.value = { label: key.label, apiKey: '' };
  keyTestMessage.value = '';
}

function cancelEditKey() {
  editingKeyId.value = '';
  keyForm.value = { label: '', apiKey: '' };
}

async function testKey(key: ApiKeyInfo) {
  testingKeyId.value = key.key_id;
  keyTestMessage.value = '';
  try {
    const result = await api.testConnection({
      provider: selectedProvider.value,
      model: selectedModel.value,
      baseUrl: baseUrl.value,
      keyId: key.key_id,
    });
    ElMessage.success(`${key.label} 连接成功，延迟 ${result.latencyMs}ms`);
    await loadKeys(selectedProvider.value);
  } catch (error) {
    keyTestMessage.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(keyTestMessage.value);
    await loadKeys(selectedProvider.value);
  } finally {
    testingKeyId.value = '';
  }
}

async function removeKey(key: ApiKeyInfo) {
  try {
    await api.deleteApiKey(key.key_id);
    ElMessage.success('密钥已删除');
    await loadKeys(selectedProvider.value);
    current.value = await api.settingsModel();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

function statusText(key: ApiKeyInfo) {
  if (key.source === 'env') return '环境变量';
  if (key.source === 'none') return '无需密钥';
  if (key.status === 'cooling') return `冷却至 ${fmtCooldown(key.cooldown_until)}`;
  if (key.status === 'missing') return '未配置';
  return '可用';
}

function statusType(key: ApiKeyInfo) {
  if (key.status === 'active') return 'success';
  if (key.status === 'cooling') return 'warning';
  return 'danger';
}

function fmtCooldown(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

onMounted(load);
</script>

<template>
  <div class="page" v-loading="loading">
    <el-alert
      v-if="errorMessage"
      class="settings-error"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
    />

    <section class="settings-band">
      <span class="band-icon"><el-icon><Cpu /></el-icon></span>
      <div class="band-main">
        <p class="band-kicker">当前模型</p>
        <h2 class="band-title">{{ currentModelLabel }}</h2>
        <p class="band-url">{{ current?.baseUrl || '尚未配置 Base URL' }}</p>
      </div>
      <div class="band-tags">
        <el-tag effect="plain">思考强度 · {{ reasoningText }}</el-tag>
        <el-tag effect="plain" :type="activeKeyCount > 0 ? 'success' : 'warning'">
          {{ current?.requiresKey ? `${activeKeyCount} 个可用 Key` : '本地模型' }}
        </el-tag>
        <el-tag :type="current?.configured ? 'success' : 'danger'" effect="plain">
          {{ current?.configured ? '已配置' : '待配置' }}
        </el-tag>
      </div>
    </section>

    <section class="section settings-grid">
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Provider 与模型</h2>
              <p class="panel-sub">切换厂商与模型，保存后对话立即使用新模型</p>
            </div>
            <el-icon class="panel-head-icon"><Setting /></el-icon>
          </div>
          <div class="panel-body">
            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">Provider</label>
                <el-select v-model="selectedProvider" placeholder="选择 Provider" @change="onProviderChange">
                  <el-option
                    v-for="provider in providers"
                    :key="provider.id"
                    :label="provider.name"
                    :value="provider.id"
                  >
                    <span class="option-main">{{ provider.name }}</span>
                    <span class="option-note">{{ provider.env ? '环境变量' : provider.api === 'anthropic-messages' ? 'Anthropic' : 'OpenAI 兼容' }}</span>
                  </el-option>
                </el-select>
              </div>
              <div class="form-field">
                <label class="field-label">模型</label>
                <el-select v-model="selectedModel" placeholder="选择模型">
                  <el-option
                    v-for="model in modelOptions"
                    :key="model.id"
                    :label="model.name"
                    :value="model.id"
                  >
                    <span class="option-main">{{ model.name }}</span>
                    <span class="option-note">{{ model.reasoning ? '推理模型' : '标准模型' }}{{ model.vision ? ' · 支持图片' : '' }}</span>
                  </el-option>
                </el-select>
              </div>
            </div>

            <div class="form-field base-field">
              <label class="field-label">Base URL</label>
              <el-input v-model="baseUrl" placeholder="https://api.example.com/v1" />
              <p class="field-hint">
                {{ providerDef?.note ?? 'OpenAI 兼容端点需包含版本前缀，例如 /v1。' }}
              </p>
            </div>

            <div class="reasoning-block">
              <div class="reasoning-head">
                <label class="field-label">思考强度</label>
                <span class="field-hint">按模型能力映射，非推理模型自动忽略</span>
              </div>
              <el-segmented v-model="reasoning" :options="[
                { label: '低（节能）', value: 'low' },
                { label: '中（均衡）', value: 'medium' },
                { label: '高（深度）', value: 'high' },
              ]" />
              <p class="reasoning-desc">
                {{
                  reasoning === 'low'
                    ? '适合日常对话与快速问答，延迟更低、消耗更少。'
                    : reasoning === 'medium'
                      ? '适合一般讲解与出题，在质量和延迟之间取平衡。'
                      : '适合难题、多步推理与考试复盘，更充分但更慢、更贵。'
                }}
              </p>
              <el-button link type="primary" class="reasoning-save" @click="saveReasoningOnly">
                仅保存思考强度
              </el-button>
            </div>

            <div class="model-actions">
              <el-button type="primary" :loading="savingModel" @click="saveModel">保存模型设置</el-button>
              <el-button :icon="Connection" :loading="testing" @click="testCurrent">测试连接</el-button>
              <span v-if="selectedModelDef" class="model-meta numeric">
                {{ selectedModelDef.contextWindow.toLocaleString() }} 上下文 · 最大
                {{ selectedModelDef.maxTokens.toLocaleString() }} tokens
              </span>
            </div>

            <el-alert
              v-if="testResult"
              class="test-result"
              :type="testResult.success ? 'success' : 'error'"
              :closable="false"
              show-icon
            >
              <template #title>
                {{ testResult.success ? '连接成功' : '连接失败' }}
                <span v-if="testResult.success" class="test-latency">{{ testResult.latencyMs }}ms</span>
              </template>
              <p>{{ testResult.message }}</p>
            </el-alert>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">生成参数</h2>
              <p class="panel-sub">全局默认值与按场景覆盖；留空表示跟随默认</p>
            </div>
            <el-button text :loading="savingGeneration" @click="saveGeneration">保存参数</el-button>
          </div>
          <div class="panel-body">
            <div class="gen-grid">
              <div class="gen-field">
                <label class="field-label">Temperature · {{ generation.temperature.toFixed(2) }}</label>
                <el-slider v-model="generation.temperature" :min="0" :max="1.5" :step="0.05" />
              </div>
              <div class="gen-field">
                <label class="field-label">Top P · {{ generation.topP.toFixed(2) }}</label>
                <el-slider v-model="generation.topP" :min="0" :max="1" :step="0.01" />
              </div>
              <div class="gen-field">
                <label class="field-label">Max tokens</label>
                <el-input-number v-model="generation.maxTokens" :min="1" :max="200000" :step="256" controls-position="right" />
                <span class="field-hint">输出上限（含思考 token）。长题建议 8192–16384，过低会中途截断。</span>
              </div>
              <div class="gen-field">
                <label class="field-label">上下文长度</label>
                <el-input-number v-model="generation.contextLength" :min="512" :max="2000000" :step="1024" controls-position="right" />
              </div>
              <div class="gen-field">
                <label class="field-label">月度预算（USD，0 为不限额）</label>
                <el-input-number v-model="generation.monthlyBudget" :min="0" :max="100000" :step="1" controls-position="right" />
              </div>
            </div>

            <el-table :data="scenarioRows" size="small" class="scenario-table">
              <el-table-column prop="label" label="场景" min-width="120">
                <template #default="{ row }">
                  <span class="scenario-label">{{ row.label }}</span>
                  <span class="scenario-note">{{ row.note }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Temperature" width="142">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.temperature"
                    :min="0"
                    :max="2"
                    :step="0.05"
                    :controls="false"
                    size="small"
                    placeholder="跟随默认"
                  />
                </template>
              </el-table-column>
              <el-table-column label="Top P" width="112">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.topP"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :controls="false"
                    size="small"
                    placeholder="跟随默认"
                  />
                </template>
              </el-table-column>
              <el-table-column label="Max tokens" width="128">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.maxTokens"
                    :min="1"
                    :max="200000"
                    :step="256"
                    :controls="false"
                    size="small"
                    placeholder="跟随默认"
                  />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="86" align="right">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="clearScenario(row as ScenarioRow)">
                    跟随默认
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">API Key</h2>
              <p class="panel-sub">
                {{ requiresKey ? '同 Provider 可配置多个 Key，自动轮询与故障切换' : '该 Provider 无需密钥' }}
              </p>
            </div>
            <el-icon class="panel-head-icon"><Key /></el-icon>
          </div>
          <div class="panel-body">
            <div class="key-list">
              <div v-for="key in keyList" :key="key.key_id" class="key-row">
                <div class="key-main">
                  <div class="key-title">
                    <span class="key-label">{{ key.label }}</span>
                    <el-tag size="small" :type="statusType(key)" effect="plain">{{ statusText(key) }}</el-tag>
                  </div>
                  <p class="key-mask numeric">{{ key.masked }}</p>
                  <p v-if="key.last_error" class="key-error">{{ key.last_error }}</p>
                  <p v-if="key.last_used_at" class="key-meta">
                    最近使用 {{ new Date(key.last_used_at).toLocaleString('zh-CN') }}
                  </p>
                </div>
                <div class="key-actions">
                  <el-button
                    v-if="key.source === 'db'"
                    link
                    type="primary"
                    size="small"
                    @click="editKey(key)"
                  >
                    更新
                  </el-button>
                  <el-button
                    v-if="key.source !== 'none'"
                    link
                    type="primary"
                    size="small"
                    :loading="testingKeyId === key.key_id"
                    @click="testKey(key)"
                  >
                    测试
                  </el-button>
                  <el-popconfirm
                    v-if="key.source === 'db'"
                    title="删除这个密钥？"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    @confirm="removeKey(key)"
                  >
                    <template #reference>
                      <el-button link type="danger" size="small" :icon="Delete">删除</el-button>
                    </template>
                  </el-popconfirm>
                </div>
              </div>
              <el-empty v-if="keyList.length === 0" description="尚未配置密钥" :image-size="64" />
            </div>

            <div v-if="requiresKey" class="key-form">
              <div class="key-form-head">
                <span class="field-label">{{ editingKeyId ? '更新密钥' : '添加密钥' }}</span>
                <el-button v-if="editingKeyId" link type="primary" size="small" @click="cancelEditKey">
                  取消更新
                </el-button>
                <el-tag v-else-if="hasEnvKey" size="small" type="info" effect="plain">环境变量密钥不可删除</el-tag>
              </div>
              <el-input v-model="keyForm.label" placeholder="名称（可选），例如：主账号" />
              <el-input
                v-model="keyForm.apiKey"
                type="password"
                show-password
                :placeholder="editingKeyId ? '输入新的 API Key，保存前会重新校验' : '粘贴 API Key，保存前会做一次最小调用校验'"
                @keyup.enter="addKey"
              />
              <el-button type="primary" class="key-submit" :icon="Plus" :loading="savingKey" @click="addKey">
                {{ editingKeyId ? '更新并测试' : '保存并测试' }}
              </el-button>
              <el-alert
                v-if="keyTestMessage"
                :title="keyTestMessage"
                type="error"
                :closable="false"
                show-icon
                class="key-alert"
              />
            </div>
            <el-alert
              v-else
              title="本地模型无需 API Key；请确认 Ollama 已启动并可访问 Base URL。"
              type="info"
              :closable="false"
              show-icon
            />
          </div>
        </div>

        <div class="panel security-panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">本地安全</h2>
              <p class="panel-sub">密钥与学习数据均不离开本机</p>
            </div>
            <el-icon class="panel-head-icon"><Lock /></el-icon>
          </div>
          <div class="panel-body">
            <ul class="security-list">
              <li><el-icon><CircleCheck /></el-icon>密钥使用 AES-256-GCM 加密，密钥材料结合本机信息派生。</li>
              <li><el-icon><CircleCheck /></el-icon>界面只回显掩码，保存前通过最小调用验证有效性。</li>
              <li><el-icon><CircleCheck /></el-icon>401 / 429 / 5xx / 超时自动切换下一个 Key，并进入冷却。</li>
              <li><el-icon><CircleCheck /></el-icon>切换模型或删除 Key 不影响已有学习数据。</li>
              <li><el-icon><CircleCheck /></el-icon>知识库向量化与重排仍使用 server/.env 的 MaaS 配置，不随对话模型切换。</li>
            </ul>
            <el-button text :icon="Refresh" class="security-refresh" @click="load(true)">刷新配置</el-button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-error {
  margin-bottom: 16px;
}

.settings-band {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px 26px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  flex-wrap: wrap;
}

.band-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 11px;
  background: var(--ink);
  color: #fff;
  font-size: 22px;
  flex: none;
}

.band-main {
  flex: 1;
  min-width: 240px;
}

.band-kicker {
  font-size: 11.5px;
  color: var(--faint);
}

.band-title {
  margin-top: 1px;
  font-family: var(--font-serif);
  font-size: 23px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.band-url {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
  word-break: break-all;
}

.band-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.band-tags :deep(.el-tag) {
  transition: none;
}

.settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(340px, 1fr);
  gap: 18px;
  align-items: start;
}

.panel-head-icon {
  font-size: 19px;
  color: var(--faint);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--muted);
}

.field-hint {
  font-size: 11px;
  color: var(--faint);
}

.base-field {
  margin-top: 14px;
}

.reasoning-block {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.reasoning-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 9px;
}

.reasoning-desc {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--muted);
}

.reasoning-save {
  margin-top: 4px;
}

.model-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.model-meta {
  font-size: 11px;
  color: var(--faint);
}

.test-result {
  margin-top: 14px;
}

.test-latency {
  margin-left: 8px;
  font-family: var(--font-num);
  font-size: 11px;
  font-weight: 400;
}

.option-main {
  margin-right: 12px;
}

.option-note {
  float: right;
  font-size: 11px;
  color: var(--faint);
}

.gen-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  margin-bottom: 20px;
}

.gen-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gen-field :deep(.el-input-number) {
  width: 100%;
}

.scenario-table {
  border-top: 1px solid var(--line);
}

.scenario-table :deep(.el-table__header th) {
  background: transparent;
}

.scenario-label {
  display: block;
  color: var(--ink-soft);
}

.scenario-note {
  display: block;
  font-size: 10.5px;
  color: var(--faint);
}

.scenario-table :deep(.el-input-number .el-input__inner) {
  text-align: left;
}

.key-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.key-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}

.key-row:first-child {
  padding-top: 2px;
}

.key-row:last-child {
  border-bottom: 0;
}

.key-main {
  min-width: 0;
}

.key-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.key-label {
  font-size: 13px;
  color: var(--ink);
}

.key-mask {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.key-meta {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--faint);
}

.key-error {
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--danger);
  overflow-wrap: anywhere;
}

.key-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.key-form {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.key-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.key-submit {
  width: 100%;
}

.key-alert {
  margin-top: 2px;
}

.security-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.security-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--muted);
}

.security-list .el-icon {
  flex: none;
  margin-top: 2px;
  color: var(--success);
}

.security-refresh {
  margin-top: 14px;
}

@media (max-width: 1100px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .form-grid,
  .gen-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-band {
    padding: 18px;
    align-items: flex-start;
  }

  .band-main {
    min-width: 0;
    flex: 1 1 200px;
  }

  .band-tags {
    width: 100%;
  }

  .band-title {
    font-size: 20px;
  }

  .scenario-table {
    font-size: 12px;
  }
}
</style>