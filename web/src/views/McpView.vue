<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Connection, Delete, EditPen, Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  confirmMcpTool,
  createMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  testMcpServer,
  toggleMcpTool,
  updateMcpServer,
  type McpExposure,
  type McpServerView,
  type McpToolInfo,
  type McpTransport,
} from '../api/mcp';

const servers = ref<McpServerView[]>([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const testingId = ref('');
const togglingTool = ref('');
const form = reactive({
  name: '',
  transport: 'stdio' as McpTransport,
  command: '',
  argsText: '',
  url: '',
  envText: '',
  headersText: '',
  exposure: 'direct' as McpExposure,
  enabled: true,
});

const isRemote = computed(() => form.transport !== 'stdio');
const statusMeta: Record<McpServerView['status'], { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  connected: { label: '已连接', type: 'success' },
  error: { label: '连接失败', type: 'danger' },
  unknown: { label: '待测试', type: 'warning' },
  disabled: { label: '已停用', type: 'info' },
};
const exposureLabels: Record<McpExposure, string> = {
  direct: '直连工具',
  deferred: '延迟加载',
  codemode: '代码模式',
  hidden: '隐藏',
};
const transportLabels: Record<McpTransport, string> = {
  stdio: '本地 stdio',
  http: 'HTTP',
  sse: 'SSE',
};

function parseLines(text: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (key) output[key] = line.slice(index + 1).trim();
  }
  return output;
}

function argsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function commandLine(server: McpServerView): string {
  if (server.transport !== 'stdio') return server.url ?? '';
  return [server.command, ...server.args].filter(Boolean).join(' ');
}

function replaceServer(server: McpServerView) {
  const index = servers.value.findIndex((item) => item.server_id === server.server_id);
  if (index >= 0) servers.value[index] = server;
  else servers.value.push(server);
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await fetchMcpServers();
    servers.value = data.servers;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function openAdd() {
  editingId.value = null;
  Object.assign(form, {
    name: '',
    transport: 'stdio' as McpTransport,
    command: '',
    argsText: '',
    url: '',
    envText: '',
    headersText: '',
    exposure: 'direct' as McpExposure,
    enabled: true,
  });
  dialogOpen.value = true;
}

function openEdit(server: McpServerView) {
  editingId.value = server.server_id;
  Object.assign(form, {
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    argsText: server.args.join('\n'),
    url: server.url ?? '',
    envText: '',
    headersText: '',
    exposure: server.exposure,
    enabled: server.enabled,
  });
  dialogOpen.value = true;
}

async function submit() {
  const name = form.name.trim();
  if (!name) {
    ElMessage.warning('请填写 MCP 名称');
    return;
  }
  if (isRemote.value && !form.url.trim()) {
    ElMessage.warning('请填写远程 MCP URL');
    return;
  }
  if (!isRemote.value && !form.command.trim()) {
    ElMessage.warning('请填写启动命令');
    return;
  }
  const base = {
    name,
    transport: form.transport,
    command: isRemote.value ? undefined : form.command.trim(),
    args: isRemote.value ? [] : argsOf(form.argsText),
    url: isRemote.value ? form.url.trim() : undefined,
    exposure: form.exposure,
    enabled: form.enabled,
  };
  const env = parseLines(form.envText);
  const headers = parseLines(form.headersText);
  saving.value = true;
  try {
    if (editingId.value) {
      const { server } = await updateMcpServer(editingId.value, {
        ...base,
        ...(Object.keys(env).length ? { env } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      });
      replaceServer(server);
      ElMessage.success('MCP 配置已更新，请测试连接');
    } else {
      const { server } = await createMcpServer({
        ...base,
        ...(Object.keys(env).length ? { env } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      });
      replaceServer(server);
      ElMessage.success('MCP 已添加，正在测试连接');
      dialogOpen.value = false;
      await runTest(server);
      return;
    }
    dialogOpen.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function runTest(server: McpServerView) {
  testingId.value = server.server_id;
  try {
    const result = await testMcpServer(server.server_id);
    replaceServer(result.server);
    ElMessage.success(`连接成功，发现 ${result.server.tools.length} 个工具（${result.latency_ms}ms）`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
    await load();
  } finally {
    testingId.value = '';
  }
}

async function toggleEnabled(server: McpServerView, value: string | number | boolean) {
  try {
    const { server: updated } = await updateMcpServer(server.server_id, { enabled: Boolean(value) });
    replaceServer(updated);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
    await load();
  }
}

async function remove(server: McpServerView) {
  try {
    await ElMessageBox.confirm(
      `删除 MCP 服务「${server.name}」？已注册的 MCP 工具将从智能体中移除。`,
      '删除 MCP',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteMcpServer(server.server_id);
    servers.value = servers.value.filter((item) => item.server_id !== server.server_id);
    ElMessage.success('MCP 服务已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function toggleTool(server: McpServerView, tool: McpToolInfo, value: string | number | boolean) {
  const key = `${server.server_id}:${tool.name}`;
  togglingTool.value = key;
  try {
    const { server: updated } = await toggleMcpTool(server.server_id, tool.name, Boolean(value));
    replaceServer(updated);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    togglingTool.value = '';
  }
}

async function confirmTool(server: McpServerView, tool: McpToolInfo) {
  const key = `${server.server_id}:${tool.name}`;
  try {
    await ElMessageBox.confirm(
      `工具「${tool.name}」可能修改外部状态。确认授权后，智能体可以直接调用它。`,
      '确认副作用工具',
      { type: 'warning', confirmButtonText: '确认授权', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  togglingTool.value = key;
  try {
    const { server: updated } = await confirmMcpTool(server.server_id, tool.name);
    replaceServer(updated);
    ElMessage.success('已确认该工具');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    togglingTool.value = '';
  }
}

onMounted(load);
</script>

<template>
  <div class="page mcp-page" v-loading="loading">
    <header class="mcp-head">
      <div>
        <h1 class="mcp-title">MCP 扩展</h1>
        <p class="mcp-sub">按需接入本地 stdio 或远程 HTTP/SSE 服务，工具会以 mcp__服务__工具 注册给智能体。</p>
      </div>
      <div class="mcp-head-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openAdd">添加 MCP 服务</el-button>
      </div>
    </header>

    <el-alert
      v-if="errorMessage"
      class="mcp-error"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
    />

    <section class="mcp-note">
      <span class="mcp-note-icon"><el-icon><Connection /></el-icon></span>
      <div>
        <p class="mcp-note-title">连接前请确认来源可信</p>
        <p class="mcp-note-text">
          本地命令会以当前用户权限运行，远程服务会收到你发送的参数。env / headers 加密保存在本机，接口只返回键名；
          有副作用的工具建议逐项关闭授权。
        </p>
      </div>
    </section>

    <section v-if="servers.length" class="mcp-list">
      <article v-for="server in servers" :key="server.server_id" class="panel mcp-card">
        <div class="mcp-card-head">
          <div class="mcp-title-line">
            <h2>{{ server.name }}</h2>
            <el-tag size="small" :type="statusMeta[server.status].type" effect="plain">
              {{ statusMeta[server.status].label }}
            </el-tag>
            <el-tag size="small" type="info" effect="plain">{{ transportLabels[server.transport] }}</el-tag>
            <el-tag size="small" effect="plain">{{ exposureLabels[server.exposure] }}</el-tag>
          </div>
          <div class="mcp-actions">
            <el-switch
              :model-value="server.enabled"
              size="small"
              @change="(value) => toggleEnabled(server, value)"
            />
            <el-button
              size="small"
              :loading="testingId === server.server_id"
              @click="runTest(server)"
            >
              测试连接
            </el-button>
            <el-button text size="small" :icon="EditPen" @click="openEdit(server)">编辑</el-button>
            <el-button text size="small" type="danger" :icon="Delete" @click="remove(server)">删除</el-button>
          </div>
        </div>

        <p class="mcp-command"><code>{{ commandLine(server) }}</code></p>
        <p v-if="server.last_error" class="mcp-error-text">{{ server.last_error }}</p>

        <div class="mcp-meta">
          <span>工具 {{ server.tools.filter((tool) => tool.enabled).length }} / {{ server.tools.length }}</span>
          <span v-if="server.env_keys.length">env：{{ server.env_keys.join('、') }}</span>
          <span v-if="server.header_keys.length">headers：{{ server.header_keys.join('、') }}</span>
        </div>

        <div v-if="server.tools.length" class="mcp-tools">
          <div v-for="tool in server.tools" :key="tool.name" class="mcp-tool">
            <el-checkbox
              :model-value="tool.enabled"
              :disabled="togglingTool === `${server.server_id}:${tool.name}`"
              @change="(value) => toggleTool(server, tool, value)"
            >
              <code>{{ tool.name }}</code>
            </el-checkbox>
            <el-tag v-if="tool.side_effect" size="small" type="warning" effect="plain">副作用</el-tag>
            <el-tag
              v-if="tool.side_effect && tool.confirmed_at"
              size="small"
              type="success"
              effect="plain"
            >
              已确认
            </el-tag>
            <el-button
              v-if="tool.enabled && tool.side_effect && !tool.confirmed_at"
              text
              size="small"
              type="primary"
              :loading="togglingTool === `${server.server_id}:${tool.name}`"
              @click="confirmTool(server, tool)"
            >
              确认授权
            </el-button>
            <span class="mcp-tool-desc">{{ tool.description || '无描述' }}</span>
          </div>
        </div>
        <p v-else class="mcp-no-tools">尚未发现工具，点击“测试连接”获取工具列表。</p>
      </article>
    </section>

    <section v-else-if="!loading" class="panel mcp-empty">
      <el-empty
        description="还没有接入 MCP 服务。添加本地或远程 MCP 后，测试连接即可发现工具并授权给智能体。"
        :image-size="90"
      >
        <el-button type="primary" :icon="Plus" @click="openAdd">添加 MCP 服务</el-button>
      </el-empty>
    </section>

    <el-dialog
      v-model="dialogOpen"
      :title="editingId ? '编辑 MCP 服务' : '添加 MCP 服务'"
      width="560px"
      align-center
    >
      <el-form label-position="top">
        <div class="mcp-form-grid">
          <el-form-item label="名称">
            <el-input v-model="form.name" placeholder="例如 web-search" maxlength="40" />
          </el-form-item>
          <el-form-item label="传输方式">
            <el-select v-model="form.transport">
              <el-option value="stdio" label="本地 stdio" />
              <el-option value="http" label="HTTP" />
              <el-option value="sse" label="SSE" />
            </el-select>
          </el-form-item>
        </div>

        <template v-if="!isRemote">
          <el-form-item label="启动命令">
            <el-input v-model="form.command" placeholder="例如 npx 或 uvx 或 node" />
          </el-form-item>
          <el-form-item label="启动参数（每行一个）">
            <el-input
              v-model="form.argsText"
              type="textarea"
              :rows="3"
              placeholder="-y\n@modelcontextprotocol/server-xxx"
            />
          </el-form-item>
          <el-form-item label="环境变量（KEY=VALUE，每行一个）">
            <el-input
              v-model="form.envText"
              type="textarea"
              :rows="3"
              :placeholder="editingId ? '留空表示保留已保存的变量' : 'API_KEY=***'"
            />
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="服务 URL">
            <el-input v-model="form.url" placeholder="https://example.com/mcp" />
          </el-form-item>
          <el-form-item label="请求头（KEY=VALUE，每行一个）">
            <el-input
              v-model="form.headersText"
              type="textarea"
              :rows="3"
              :placeholder="editingId ? '留空表示保留已保存的请求头' : 'Authorization=Bearer ***'"
            />
          </el-form-item>
        </template>

        <div class="mcp-form-grid">
          <el-form-item label="工具暴露">
            <el-select v-model="form.exposure">
              <el-option value="direct" label="直连工具（推荐）" />
              <el-option value="deferred" label="延迟加载" />
              <el-option value="codemode" label="代码模式" />
              <el-option value="hidden" label="隐藏" />
            </el-select>
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="form.enabled" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">
          {{ editingId ? '保存修改' : '添加并测试' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mcp-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.mcp-title {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.mcp-sub {
  margin-top: 3px;
  max-width: 720px;
  font-size: 12.5px;
  color: var(--muted);
}

.mcp-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-error {
  margin-bottom: 16px;
}

.mcp-note {
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  border: 1px solid #d9e1f8;
  border-radius: var(--radius);
  background: var(--accent-soft);
}

.mcp-note-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #fff;
  color: var(--accent);
  font-size: 17px;
  flex: none;
}

.mcp-note-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-soft);
}

.mcp-note-text {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--muted);
}

.mcp-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.mcp-card {
  padding: 18px 20px;
}

.mcp-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mcp-title-line {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.mcp-title-line h2 {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 600;
}

.mcp-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mcp-command {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--muted);
  word-break: break-all;
}

.mcp-command code {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  padding: 3px 6px;
  border-radius: 5px;
  background: var(--paper);
  color: var(--ink-soft);
}

.mcp-error-text {
  margin-top: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11.5px;
}

.mcp-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 9px;
  font-size: 11px;
  color: var(--faint);
}

.mcp-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.mcp-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.mcp-tool :deep(.el-checkbox) {
  flex: none;
  height: auto;
}

.mcp-tool code {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-size: 11px;
  color: var(--ink-soft);
}

.mcp-tool-desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--faint);
}

.mcp-no-tools {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--faint);
}

.mcp-empty {
  margin-top: 16px;
  padding: 10px 20px 26px;
}

.mcp-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.mcp-form-grid :deep(.el-select) {
  width: 100%;
}

@media (max-width: 720px) {
  .mcp-title {
    font-size: 21px;
  }

  .mcp-head-actions {
    width: 100%;
  }

  .mcp-tools {
    grid-template-columns: minmax(0, 1fr);
  }

  .mcp-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
