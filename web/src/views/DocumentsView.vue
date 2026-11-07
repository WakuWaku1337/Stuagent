<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import {
  CircleCheck,
  Collection,
  Document,
  Files,
  Refresh,
  Search,
  UploadFilled,
} from '@element-plus/icons-vue';
import MetricCard from '../components/MetricCard.vue';
import { api, type DocumentItem } from '../api/data';

const docs = ref<DocumentItem[]>([]);
const fileList = ref<UploadUserFile[]>([]);
const subject = ref('数学');
const uploading = ref(false);
const loading = ref(false);
const message = ref('');
const query = ref('');
const statusFilter = ref('all');
const reindexing = ref<Set<string>>(new Set());

const indexedCount = computed(() => docs.value.filter((d) => d.status === 'indexed').length);
const chunkTotal = computed(() => docs.value.reduce((sum, d) => sum + d.chunk_count, 0));
const totalSize = computed(() => docs.value.reduce((sum, d) => sum + d.size, 0));

const visibleDocs = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return docs.value.filter((doc) => {
    if (statusFilter.value !== 'all' && doc.status !== statusFilter.value) return false;
    if (!keyword) return true;
    return (
      doc.filename.toLowerCase().includes(keyword) ||
      (doc.subject ?? '').toLowerCase().includes(keyword)
    );
  });
});

const ingestRate = computed(() =>
  docs.value.length ? Math.round((indexedCount.value / docs.value.length) * 100) : 0,
);

function statusText(s: string) {
  return (
    {
      uploaded: '已上传',
      parsed: '已解析',
      indexing: '向量化中',
      indexed: '已入库',
      failed: '失败',
    }[s] ?? s
  );
}

function statusType(s: string) {
  if (s === 'indexed') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'parsed' || s === 'indexing') return 'warning';
  return 'info';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function load() {
  loading.value = true;
  try {
    const data = await api.documents();
    docs.value = data.documents;
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function upload() {
  const files = fileList.value.flatMap((f) => (f.raw ? [f.raw] : []));
  if (files.length === 0) return;
  uploading.value = true;
  message.value = '';
  const form = new FormData();
  files.forEach((file) => form.append('file', file));
  form.append('subject', subject.value);
  try {
    const res = await fetch('/api/documents', { method: 'POST', body: form });
    const data = await res.json();
    if (res.status === 207) {
      const results = data.results as { filename: string; status: string; message?: string }[];
      const failed = results.filter((r) => r.status === 'failed');
      message.value = failed.length
        ? failed.map((r) => `${r.filename}：${r.message ?? '上传失败'}`).join('；')
        : `${results.length} 个文件已解析，正在向量化`;
      ElMessage.success(`${results.length - failed.length} 个文件已接收`);
    } else if (!res.ok) {
      throw new Error(data.message ?? data.error ?? '上传失败');
    } else {
      message.value = `${data.filename} 解析成功，${data.chunk_count} 个切片，正在向量化…`;
      ElMessage.success('文件已解析，后台开始向量化');
    }
    fileList.value = [];
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    uploading.value = false;
  }
}

async function reindex(doc: DocumentItem) {
  const next = new Set(reindexing.value);
  next.add(doc.document_id);
  reindexing.value = next;
  message.value = `正在重新向量化 ${doc.filename}…`;
  try {
    const res = await fetch(`/api/documents/${doc.document_id}/index`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? '重新灌库失败');
    message.value = `${doc.filename} 已入库（${data.chunk_count} 个切片）`;
    ElMessage.success('重新向量化完成');
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    const rest = new Set(reindexing.value);
    rest.delete(doc.document_id);
    reindexing.value = rest;
  }
}

async function remove(doc: DocumentItem) {
  try {
    const res = await fetch(`/api/documents/${doc.document_id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    ElMessage.success(`已删除 ${doc.filename}`);
    message.value = '';
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <section class="metric-grid docs-metrics">
      <MetricCard label="资料总数" :value="docs.length" suffix="份" :icon="Collection" tone="accent" hint="资料保存在本机" />
      <MetricCard label="已入库" :value="indexedCount" suffix="份" :icon="CircleCheck" tone="success" :hint="`入库率 ${ingestRate}%`" />
      <MetricCard label="知识切片" :value="chunkTotal" suffix="个" :icon="Files" tone="ink" hint="用于混合检索与引用" />
      <MetricCard label="文件体积" :value="formatSize(totalSize)" :icon="Document" tone="warning" hint="原始文件占用" />
    </section>

    <section class="section docs-layout">
      <div class="panel upload-panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">上传资料</h2>
            <p class="panel-sub">解析后自动切分并写入向量库</p>
          </div>
        </div>
        <div class="panel-body">
          <el-upload
            v-model:file-list="fileList"
            drag
            multiple
            :auto-upload="false"
            accept=".pdf,.docx,.doc,.txt,.md,.markdown"
            class="uploader"
          >
            <el-icon class="uploader-icon"><UploadFilled /></el-icon>
            <div class="uploader-text">拖拽文件到此处，或<em>点击选择</em></div>
            <div class="uploader-hint">PDF / Word / TXT / Markdown，单文件不超过 20 MB</div>
          </el-upload>

          <div class="upload-field">
            <label class="upload-label" for="subject">学科</label>
            <el-input id="subject" v-model="subject" placeholder="数学 / 化学 / 英语…" />
          </div>

          <el-button
            type="primary"
            class="upload-submit"
            :loading="uploading"
            :disabled="fileList.length === 0"
            @click="upload"
          >
            {{ uploading ? '正在上传…' : fileList.length ? `上传 ${fileList.length} 个文件` : '上传文件' }}
          </el-button>

          <el-alert
            v-if="message"
            class="upload-message"
            :title="message"
            type="info"
            :closable="false"
            show-icon
          />

          <div class="upload-note">
            <p class="upload-note-title">入库流程</p>
            <p>解析文本 → 按章节切分 → 嵌入向量 → 写入 Milvus。入库后的资料会出现在对话引用中。</p>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head docs-head">
          <div>
            <h2 class="panel-title">资料列表</h2>
            <p class="panel-sub">共 {{ docs.length }} 份，当前显示 {{ visibleDocs.length }} 份</p>
          </div>
          <div class="docs-tools">
            <el-input
              v-model="query"
              :prefix-icon="Search"
              placeholder="搜索文件名或学科"
              clearable
              class="search-input"
            />
            <el-select v-model="statusFilter" class="status-select">
              <el-option label="全部状态" value="all" />
              <el-option label="已入库" value="indexed" />
              <el-option label="处理中" value="indexing" />
              <el-option label="已解析" value="parsed" />
              <el-option label="失败" value="failed" />
            </el-select>
            <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          </div>
        </div>

        <div class="panel-body docs-body">
          <el-table v-loading="loading" :data="visibleDocs" size="default">
            <el-table-column label="文件名" min-width="210">
              <template #default="{ row }">
                <div class="doc-name">
                  <span class="doc-ext">{{ row.file_type }}</span>
                  <span class="doc-file">{{ row.filename }}</span>
                </div>
                <span v-if="row.error" class="doc-error">{{ row.error }}</span>
              </template>
            </el-table-column>
            <el-table-column label="学科" width="92">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" type="info">{{ row.subject ?? '未分科' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="108">
              <template #default="{ row }">
                <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="切片" width="76" align="right">
              <template #default="{ row }">
                <span class="numeric">{{ row.chunk_count }}</span>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="92" align="right">
              <template #default="{ row }">
                <span class="numeric muted">{{ formatSize(row.size) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="上传时间" width="124">
              <template #default="{ row }">
                <span class="muted">{{ formatDate(row.created_at) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <div class="doc-ops">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :loading="reindexing.has(row.document_id)"
                    @click="reindex(row as DocumentItem)"
                  >
                    重新灌库
                  </el-button>
                  <el-popconfirm
                    :title="`删除 ${row.filename}？切片与向量会一并清理`"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    width="230"
                    @confirm="remove(row as DocumentItem)"
                  >
                    <template #reference>
                      <el-button link type="danger" size="small">删除</el-button>
                    </template>
                  </el-popconfirm>
                </div>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty
                :description="query || statusFilter !== 'all' ? '没有符合条件的资料' : '还没有上传资料'"
                :image-size="80"
              />
            </template>
          </el-table>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.docs-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.docs-layout {
  display: grid;
  grid-template-columns: 356px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.uploader {
  width: 100%;
}

.uploader :deep(.el-upload) {
  width: 100%;
}

.uploader :deep(.el-upload-dragger) {
  padding: 24px 14px;
  border-radius: 10px;
  border-color: var(--line-strong);
  background: #fafcfb;
}

.uploader :deep(.el-upload-dragger:hover) {
  border-color: var(--accent);
}

.uploader-icon {
  font-size: 30px;
  color: var(--faint);
  margin-bottom: 8px;
}

.uploader-text {
  font-size: 13px;
  color: var(--ink-soft);
}

.uploader-text em {
  font-style: normal;
  color: var(--accent);
}

.uploader-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--faint);
}

.upload-field {
  margin-top: 16px;
}

.upload-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.upload-submit {
  width: 100%;
  margin-top: 14px;
}

.upload-message {
  margin-top: 14px;
}

.upload-note {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
}

.upload-note-title {
  margin-bottom: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-soft);
}

.docs-head {
  flex-wrap: wrap;
}

.docs-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.search-input {
  width: 200px;
}

.status-select {
  width: 118px;
}

.docs-body {
  padding-top: 4px;
}

.doc-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.doc-ext {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--paper);
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.doc-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-error {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--danger);
}

.doc-ops {
  display: flex;
  gap: 2px;
}

@media (max-width: 1180px) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .docs-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .search-input {
    width: 100%;
  }

  .docs-tools {
    width: 100%;
  }
}
</style>