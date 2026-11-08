<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { CircleCheck, Clock, Connection, MagicStick, Refresh } from '@element-plus/icons-vue';
import MetricCard from '../components/MetricCard.vue';
import MarkdownView from '../components/MarkdownView.vue';
import { api, type TaskItem } from '../api/data';

interface TaskEvent {
  time: string;
  text: string;
  status: string;
}

const tasks = ref<TaskItem[]>([]);
const knowledgePoint = ref('一元二次方程');
const count = ref(3);
const connected = ref(false);
const events = ref<TaskEvent[]>([]);
const loading = ref(false);
const creating = ref(false);
let ws: WebSocket | null = null;
let poller: ReturnType<typeof setInterval> | undefined;

const counts = computed(() => ({
  total: tasks.value.length,
  queued: tasks.value.filter((t) => t.status === 'queued').length,
  running: tasks.value.filter((t) => t.status === 'running').length,
  done: tasks.value.filter((t) => t.status === 'done').length,
}));

async function load() {
  loading.value = true;
  try {
    const data = await api.tasks();
    tasks.value = data.tasks;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    connected.value = true;
    ws?.send('ping');
  };
  ws.onclose = (event) => {
    connected.value = false;
    if (event.code === 4401) window.dispatchEvent(new Event('edupi:unauthorized'));
  };
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === 'pong') return;
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const text =
        data.type === 'connected'
          ? '实时通道已建立'
          : data.type === 'task'
            ? `${data.task?.type === 'quiz' ? '出题' : '诊断'}任务${data.task?.status ? `：${statusText(data.task.status)}` : ''}`
            : String(data.type);
      events.value.unshift({ time, text, status: data.type === 'task' ? data.task?.status ?? 'info' : 'info' });
      events.value = events.value.slice(0, 20);
      if (data.type === 'task') void load();
    } catch {
      /* 忽略非 JSON 消息 */
    }
  };
}

async function createTask() {
  creating.value = true;
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'quiz',
        payload: { knowledge_point: knowledgePoint.value, count: count.value, subject: '数学' },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? '创建任务失败');
    ElMessage.success('任务已入队，结果通过实时通道推送');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    creating.value = false;
  }
}

async function cancel(t: TaskItem) {
  try {
    const res = await fetch(`/api/tasks/${t.task_id}/cancel`, { method: 'POST' });
    if (!res.ok) throw new Error('取消失败');
    ElMessage.success('任务已取消');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

onMounted(async () => {
  await load();
  connect();
  poller = setInterval(load, 30000);
});

onBeforeUnmount(() => {
  ws?.close();
  if (poller) clearInterval(poller);
});

function statusText(s: string) {
  return (
    {
      queued: '排队中',
      running: '执行中',
      done: '完成',
      failed: '失败',
      timeout: '超时',
      cancelled: '已取消',
    }[s] ?? s
  );
}

function statusType(s: string) {
  if (s === 'done') return 'success';
  if (s === 'running') return 'primary';
  if (s === 'failed' || s === 'timeout') return 'danger';
  if (s === 'cancelled') return 'info';
  return 'warning';
}

function timelineType(s: string) {
  if (s === 'done') return 'success';
  if (s === 'failed' || s === 'timeout') return 'danger';
  if (s === 'running') return 'primary';
  if (s === 'queued') return 'warning';
  return 'info';
}

function taskLabel(type: string) {
  return type === 'quiz' ? '出题' : '诊断';
}

function resultText(t: TaskItem) {
  if (t.error) return t.error;
  if (!t.result) return '—';
  try {
    const parsed = JSON.parse(t.result) as {
      reply?: string;
      questions?: unknown[];
      count?: number;
      session_id?: string;
    };
    if (parsed.reply) return parsed.reply;
    if (parsed.questions) return `已生成 ${parsed.questions.length} 道题`;
    if (typeof parsed.count === 'number') return `后台出题完成，共 ${parsed.count} 道题`;
    if (parsed.session_id) return '任务已完成，结果已保存';
  } catch {
    /* 原文展示 */
  }
  return t.result;
}

function resultMarkdown(t: TaskItem) {
  if (t.error) return `**执行失败：** ${t.error}`;
  if (!t.result) return '任务尚未产生结果。';
  try {
    const parsed = JSON.parse(t.result) as {
      reply?: string;
      questions?: unknown[];
      count?: number;
      session_id?: string;
    };
    if (parsed.reply) return parsed.reply;
    if (parsed.questions) return `已生成 **${parsed.questions.length}** 道题。`;
    if (typeof parsed.count === 'number') {
      return `后台出题完成，共 **${parsed.count}** 道题。\n\n会话 ID：\`${parsed.session_id ?? '—'}\``;
    }
  } catch {
    /* 原文展示 */
  }
  return `\`\`\`\n${t.result}\n\`\`\``;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="page">
    <section class="metric-grid">
      <MetricCard label="任务总数" :value="counts.total" suffix="个" :icon="MagicStick" tone="ink" hint="当前会话的历史任务" />
      <MetricCard label="排队中" :value="counts.queued" suffix="个" :icon="Clock" tone="warning" hint="等待工作线程领取" />
      <MetricCard label="执行中" :value="counts.running" suffix="个" :icon="Connection" tone="accent" hint="正在调用模型或工具" />
      <MetricCard label="已完成" :value="counts.done" suffix="个" :icon="CircleCheck" tone="success" hint="结果已落库" />
    </section>

    <section class="section task-layout">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">任务列表</h2>
            <p class="panel-sub">长任务提交后立即返回，不阻塞对话</p>
          </div>
          <div class="task-tools">
            <el-tag size="small" :type="connected ? 'success' : 'danger'" effect="plain">
              {{ connected ? '实时通道已连接' : '实时通道断开' }}
            </el-tag>
            <el-button text :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          </div>
        </div>
        <div class="panel-body">
          <el-table v-loading="loading" :data="tasks">
            <el-table-column label="类型" width="82">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" type="info">{{ taskLabel(row.type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="96">
              <template #default="{ row }">
                <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="重试" width="66" align="center">
              <template #default="{ row }">
                <span class="numeric muted">{{ row.attempts }}</span>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="118">
              <template #default="{ row }">
                <span class="muted">{{ fmtTime(row.created_at) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="结果" min-width="190">
              <template #default="{ row }">
                <el-popover placement="left" :width="430" trigger="click">
                  <template #reference>
                    <button class="result-preview">{{ resultText(row as TaskItem) }}</button>
                  </template>
                  <div class="result-popover">
                    <MarkdownView :text="resultMarkdown(row as TaskItem)" />
                  </div>
                </el-popover>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'queued'"
                  link
                  type="danger"
                  size="small"
                  @click="cancel(row as TaskItem)"
                >
                  取消
                </el-button>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="暂无任务。可在右侧提交一个后台出题任务。" :image-size="80" />
            </template>
          </el-table>
        </div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">新建任务</h2>
              <p class="panel-sub">提交后由队列异步执行</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="task-field">
              <label class="field-label">知识点</label>
              <el-input v-model="knowledgePoint" placeholder="例如：一元二次方程" />
            </div>
            <div class="task-field">
              <label class="field-label">题量</label>
              <el-input-number v-model="count" :min="1" :max="10" />
            </div>
            <el-button type="primary" class="task-submit" :loading="creating" @click="createTask">
              后台生成练习
            </el-button>
            <p class="task-hint">任务结果可在列表中查看，页面刷新或服务重启后仍保留。</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">实时事件</h2>
              <p class="panel-sub">最近 20 条 WebSocket 推送</p>
            </div>
          </div>
          <div class="panel-body timeline-body">
            <el-timeline v-if="events.length">
              <el-timeline-item
                v-for="(event, index) in events"
                :key="index"
                :timestamp="event.time"
                :type="timelineType(event.status)"
                size="normal"
              >
                {{ event.text }}
              </el-timeline-item>
            </el-timeline>
            <p v-else class="inline-empty">等待事件推送…</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.task-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr);
  gap: 18px;
  align-items: start;
}

.task-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-preview {
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.55;
  cursor: pointer;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.result-preview:hover {
  color: var(--accent);
}

.result-popover {
  max-height: 380px;
  overflow-y: auto;
}

.result-popover :deep(.markdown) {
  font-size: 13px;
}

.task-field {
  margin-bottom: 13px;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
}

.task-submit {
  width: 100%;
  margin-top: 4px;
}

.task-hint {
  margin-top: 12px;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--faint);
}

.timeline-body {
  padding-top: 8px;
  max-height: 420px;
  overflow-y: auto;
}

.timeline-body :deep(.el-timeline) {
  padding-left: 4px;
}

.timeline-body :deep(.el-timeline-item__timestamp) {
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--faint);
}

.timeline-body :deep(.el-timeline-item__content) {
  font-size: 12.5px;
  color: var(--ink-soft);
}

@media (max-width: 1180px) {
  .task-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>