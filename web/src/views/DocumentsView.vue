<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import {
  CircleCheck,
  Collection,
  Document,
  Files,
  FolderOpened,
  Refresh,
  Search,
  UploadFilled,
} from '@element-plus/icons-vue';
import MetricCard from '../components/MetricCard.vue';
import { api, type DocumentItem, type OcrDetail, type OcrPageItem } from '../api/data';

const docs = ref<DocumentItem[]>([]);
const fileList = ref<UploadUserFile[]>([]);
const folderInput = ref<HTMLInputElement>();
const folderImporting = ref(false);
const subject = ref('数学');
const uploading = ref(false);
const loading = ref(false);
const message = ref('');
const query = ref('');
const statusFilter = ref('all');
const reindexing = ref<Set<string>>(new Set());
const retryingOcr = ref<Set<string>>(new Set());
const ocrDetails = ref<Record<string, OcrDetail>>({});
const reviewVisible = ref(false);
const reviewDoc = ref<DocumentItem | null>(null);
const reviewDetail = ref<OcrDetail | null>(null);
const reviewPageNo = ref<number | null>(null);
const reviewText = ref('');
const reviewSaving = ref(false);
const confirming = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
      (doc.source_path ?? '').toLowerCase().includes(keyword) ||
      (doc.subject ?? '').toLowerCase().includes(keyword)
    );
  });
});

const ingestRate = computed(() =>
  docs.value.length ? Math.round((indexedCount.value / docs.value.length) * 100) : 0,
);

const hasRunningOcr = computed(() =>
  docs.value.some(
    (doc) => doc.status === 'ocr_queued' || doc.status === 'ocr_running' || doc.status === 'indexing',
  ),
);

const reviewPages = computed<OcrPageItem[]>(
  () =>
    reviewDetail.value?.pages.filter(
      (page) => page.image_url || page.status === 'review' || page.status === 'failed',
    ) ?? [],
);

const currentReviewPage = computed<OcrPageItem | null>(
  () => reviewPages.value.find((page) => page.page === reviewPageNo.value) ?? null,
);

const pendingReviewCount = computed(
  () =>
    reviewDetail.value?.pages.filter((page) => page.status === 'review' || page.status === 'failed').length ?? 0,
);

const reviewPageStatusText = computed(() => {
  const page = currentReviewPage.value;
  if (!page) return '';
  if (page.status === 'confirmed') return '已校对';
  if (page.status === 'failed') return '识别失败';
  if (page.status === 'review') return '待校对';
  return '识别完成';
});

function statusText(s: string) {
  return (
    {
      uploaded: '已上传',
      parsed: '已解析',
      indexing: '向量化中',
      indexed: '已入库',
      failed: '失败',
      ocr_queued: '待 OCR',
      ocr_running: 'OCR 中',
      needs_review: '待校对',
    }[s] ?? s
  );
}

function statusType(s: string) {
  if (s === 'indexed') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'needs_review') return 'warning';
  if (s === 'parsed' || s === 'indexing' || s === 'ocr_queued' || s === 'ocr_running') return 'warning';
  return 'info';
}

function ocrJob(doc: DocumentItem) {
  return ocrDetails.value[doc.document_id]?.job ?? null;
}

function ocrProgressText(doc: DocumentItem) {
  const job = ocrJob(doc);
  if (!job) return '';
  const docling = job.engine === 'auto' || job.engine.startsWith('docling');
  const current = job.current_page
    ? ` · 第 ${job.current_page} 页`
    : docling && job.status === 'running'
      ? ' · 整篇解析中'
      : '';
  return `${job.done_pages}/${job.total_pages} 页 · ${job.progress}%${current}`;
}

function reviewCount(doc: DocumentItem) {
  return ocrJob(doc)?.review_pages.length ?? 0;
}

function canReview(doc: DocumentItem) {
  return (
    doc.status === 'needs_review' ||
    (doc.status === 'failed' && (ocrDetails.value[doc.document_id]?.pages.length ?? 0) > 0)
  );
}

function canRetryOcr(doc: DocumentItem) {
  return doc.status === 'failed' && Boolean(ocrJob(doc));
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
    await loadOcrDetails();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function loadOcrDetails() {
  const targets = docs.value.filter((doc) =>
    ['ocr_queued', 'ocr_running', 'needs_review'].includes(doc.status),
  );
  const entries = await Promise.all(
    targets.map(async (doc) => {
      try {
        return [doc.document_id, await api.ocrDetail(doc.document_id)] as const;
      } catch {
        return null;
      }
    }),
  );
  const next: Record<string, OcrDetail> = {};
  for (const entry of entries) {
    if (entry) next[entry[0]] = entry[1];
  }
  ocrDetails.value = next;
}

async function pollOcr() {
  if (!hasRunningOcr.value) return;
  try {
    const data = await api.documents();
    docs.value = data.documents;
    await loadOcrDetails();
  } catch {
    // 轮询失败保持现状，下一轮重试
  }
}

async function retryOcr(doc: DocumentItem) {
  const next = new Set(retryingOcr.value);
  next.add(doc.document_id);
  retryingOcr.value = next;
  message.value = `正在重新执行 ${doc.filename} 的 OCR…`;
  try {
    await api.retryOcr(doc.document_id);
    ElMessage.success('OCR 已重新入队');
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    const rest = new Set(retryingOcr.value);
    rest.delete(doc.document_id);
    retryingOcr.value = rest;
  }
}

async function openReview(doc: DocumentItem) {  try {
    const detail = await api.ocrDetail(doc.document_id);
    if (!detail.job) {
      ElMessage.warning('该文档没有 OCR 任务');
      return;
    }
    reviewDoc.value = doc;
    reviewDetail.value = detail;
    const pages = detail.pages.filter(
      (page) => page.image_url || page.status === 'review' || page.status === 'failed',
    );
    const first =
      pages.find((page) => page.status === 'review' || page.status === 'failed') ?? pages[0] ?? null;
    reviewPageNo.value = first?.page ?? null;
    reviewText.value = first?.markdown ?? '';
    reviewVisible.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

function selectReviewPage(pageNo: number | null) {
  if (pageNo === null) return;
  const page = reviewPages.value.find((item) => item.page === pageNo);
  reviewPageNo.value = pageNo;
  reviewText.value = page?.markdown ?? '';
}

function moveReviewPage(step: number) {
  const index = reviewPages.value.findIndex((page) => page.page === reviewPageNo.value);
  const next = reviewPages.value[index + step];
  if (next) selectReviewPage(next.page);
}

function reviewHasSibling(step: number) {
  const index = reviewPages.value.findIndex((page) => page.page === reviewPageNo.value);
  return Boolean(reviewPages.value[index + step]);
}

function reviewPageLabel(page: OcrPageItem) {
  const status =
    page.status === 'confirmed'
      ? '已校对'
      : page.status === 'failed'
        ? '识别失败'
        : page.status === 'review'
          ? '待校对'
          : '已识别';
  return `第 ${page.page} 页 · ${status} · ${Math.round(page.confidence * 100)}%`;
}

async function saveReviewPage(confirm: boolean) {
  const doc = reviewDoc.value;
  const page = currentReviewPage.value;
  if (!doc || !page) return;
  if (!reviewText.value.trim()) {
    ElMessage.warning('校对文本不能为空');
    return;
  }
  reviewSaving.value = true;
  try {
    const result = await api.saveOcrPage(doc.document_id, page.page, reviewText.value, confirm);
    page.markdown = reviewText.value;
    page.status = result.status;
    if (reviewDetail.value?.job) {
      const remaining = reviewDetail.value.pages.filter(
        (item) => item.status === 'review' || item.status === 'failed',
      ).length;
      reviewDetail.value.job.review_required = remaining > 0;
      reviewDetail.value.job.review_pages = reviewDetail.value.pages
        .filter((item) => item.status === 'review' || item.status === 'failed')
        .map((item) => item.page);
      reviewDetail.value.job.low_confidence = remaining;
    }
    ElMessage.success(confirm ? `第 ${page.page} 页已标记校对完成` : `第 ${page.page} 页草稿已保存`);
    if (confirm) {
      const next = reviewPages.value.find(
        (item) => item.page !== page.page && (item.status === 'review' || item.status === 'failed'),
      );
      if (next) selectReviewPage(next.page);
      else await load();
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    reviewSaving.value = false;
  }
}

async function confirmReview() {
  const doc = reviewDoc.value;
  if (!doc) return;
  confirming.value = true;
  try {
    const result = await api.confirmOcr(doc.document_id);
    ElMessage.success(`校对已写回并开始重新入库（${result.chunk_count} 个切片）`);
    reviewVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    confirming.value = false;
  }
}

async function upload() {
  const files = fileList.value.flatMap((f) => (f.raw ? [f.raw] : []));
  if (files.length === 0) return;
  if (files.length > MAX_BATCH_FILES) {
    ElMessage.error(`单次最多上传 ${MAX_BATCH_FILES} 个文件，请分批选择`);
    return;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    ElMessage.error('单次上传总大小不能超过 200MB，请分批上传');
    return;
  }
  const oversized = files.filter((file) => file.size > MAX_FILE_BYTES);
  if (oversized.length > 0) {
    ElMessage.error(
      `有 ${oversized.length} 个文件超过单文件 50MB：${oversized.slice(0, 3).map((file) => file.name).join('、')}`,
    );
    return;
  }
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
    } else if (data.status === 'ocr_queued') {
      message.value = `检测到图片型 PDF（${data.ocr_pages ?? 0} 页）：扫描件将进行 OCR，需几分钟，完成后可在这里查看进度与低置信页校对。`;
      ElMessage.success('扫描件已进入 OCR 队列');
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

const FOLDER_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.markdown']);
// 与 server/src/documents/limits.ts 保持一致
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_BATCH_FILES = 50;
const MAX_BATCH_BYTES = 200 * 1024 * 1024;
const MAX_FOLDER_FILES = 100;
const MAX_FOLDER_BYTES = MAX_BATCH_BYTES;
const FOLDER_BATCH_FILES = 20;

interface FolderFile {
  file: File;
  path: string;
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: FsEntry[]) => void, error?: (error: unknown) => void) => void;
  };
}

function relativePath(file: File): string {
  const item = file as File & { webkitRelativePath?: string };
  return item.webkitRelativePath || file.name;
}

async function uploadFolderFiles(items: FolderFile[]) {
  const accepted = items.filter((item) => {
    const index = item.file.name.lastIndexOf('.');
    return index >= 0 && FOLDER_EXTENSIONS.has(item.file.name.slice(index).toLowerCase());
  });
  const skipped = items.length - accepted.length;
  if (accepted.length === 0) {
    ElMessage.warning('所选文件夹中没有 PDF / Word / TXT / Markdown 资料');
    return;
  }
  if (accepted.length > MAX_FOLDER_FILES) {
    ElMessage.error(`一次最多导入 ${MAX_FOLDER_FILES} 个文件，请分批选择`);
    return;
  }
  const totalBytes = accepted.reduce((sum, item) => sum + item.file.size, 0);
  if (totalBytes > MAX_FOLDER_BYTES) {
    ElMessage.error('文件夹总大小不能超过 200MB，请分批导入');
    return;
  }
  const oversized = accepted.filter((item) => item.file.size > MAX_FILE_BYTES);
  if (oversized.length > 0) {
    ElMessage.error(
      `有 ${oversized.length} 个文件超过单文件 50MB：${oversized.slice(0, 3).map((item) => item.file.name).join('、')}`,
    );
    return;
  }

  folderImporting.value = true;
  message.value = '';
  let uploaded = 0;
  const failures: string[] = [];
  try {
    for (let index = 0; index < accepted.length; index += FOLDER_BATCH_FILES) {
      const batch = accepted.slice(index, index + FOLDER_BATCH_FILES);
      const form = new FormData();
      batch.forEach((item) => form.append('file', item.file, item.file.name));
      form.append('paths', JSON.stringify(batch.map((item) => item.path)));
      form.append('subject', subject.value);
      const res = await fetch('/api/documents/batch', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        throw new Error(data.message ?? data.error ?? '批量导入失败');
      }
      const results = Array.isArray(data.results) ? data.results : [data];
      for (const result of results) {
        if (result.status === 'failed') {
          failures.push(`${result.source_path ?? result.filename}：${result.message ?? '上传失败'}`);
        } else {
          uploaded += 1;
        }
      }
    }
    message.value = failures.length
      ? `${uploaded} 个文件已接收；${failures.length} 个失败：${failures.slice(0, 4).join('；')}`
      : `${uploaded} 个文件已接收${skipped ? `（忽略 ${skipped} 个不支持的文件）` : ''}，正在解析与向量化`;
    if (uploaded > 0) ElMessage.success(`${uploaded} 个文件已接收`);
    else ElMessage.error(message.value);
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    folderImporting.value = false;
  }
}

function onFolderPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  void uploadFolderFiles(files.map((file) => ({ file, path: relativePath(file) })));
}

function readEntry(entry: FsEntry, base: string, output: FolderFile[]): Promise<void> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve, reject) => {
      entry.file?.(
        (file) => {
          output.push({ file, path: `${base}${entry.name}` });
          resolve();
        },
        reject,
      );
    });
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const readBatch = () =>
      new Promise<FsEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
    return (async () => {
      for (;;) {
        const batch = await readBatch();
        if (batch.length === 0) return;
        for (const child of batch) {
          await readEntry(child, `${base}${entry.name}/`, output);
        }
      }
    })();
  }
  return Promise.resolve();
}

async function onFolderDrop(event: DragEvent) {
  const items = Array.from(
    { length: event.dataTransfer?.items.length ?? 0 },
    (_, index) => event.dataTransfer!.items[index],
  );
  const entries = items
    .map(
      (item) =>
        (item as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.(),
    )
    .filter((entry): entry is FsEntry => entry !== null && entry !== undefined);
  if (entries.length === 0) return;
  const output: FolderFile[] = [];
  for (const entry of entries) {
    await readEntry(entry, '', output);
  }
  await uploadFolderFiles(output);
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

onMounted(async () => {
  await load();
  pollTimer = setInterval(pollOcr, 2500);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});
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
            <div class="uploader-hint">PDF / Word / TXT / Markdown，单文件不超过 50 MB、单次最多 50 个文件 / 200 MB</div>
          </el-upload>

          <input
            ref="folderInput"
            type="file"
            webkitdirectory
            multiple
            accept=".pdf,.docx,.doc,.txt,.md,.markdown"
            class="folder-input"
            @change="onFolderPick"
          />
          <div class="folder-tools">
            <el-button plain :icon="FolderOpened" :loading="folderImporting" @click="folderInput?.click()">
              导入文件夹
            </el-button>
            <span class="folder-hint">保留相对路径作为章节分类，单次最多 100 个文件</span>
          </div>
          <div class="folder-drop" @dragover.prevent @drop.prevent="onFolderDrop">
            <el-icon><FolderOpened /></el-icon>
            <span>或把文件夹拖到这里批量导入</span>
          </div>

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
            <p>解析文本 → 按章节切分 → 嵌入向量 → 写入 Milvus。图片型 PDF 会自动按页 OCR，低置信页需人工校对后入库。</p>
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
              <el-option label="待 OCR" value="ocr_queued" />
              <el-option label="OCR 中" value="ocr_running" />
              <el-option label="待校对" value="needs_review" />
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
                <span v-if="row.source_path && row.source_path !== row.filename" class="doc-path" :title="row.source_path">
                  {{ row.source_path }}
                </span>
                <span v-if="row.error" class="doc-error">{{ row.error }}</span>
              </template>
            </el-table-column>
            <el-table-column label="学科" width="92">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" type="info">{{ row.subject ?? '未分科' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="160">
              <template #default="{ row }">
                <div class="doc-status">
                  <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
                  <template v-if="row.status === 'ocr_queued' || row.status === 'ocr_running'">
                    <span class="doc-ocr-progress">{{ ocrProgressText(row as DocumentItem) }}</span>
                    <el-progress
                      :percentage="ocrJob(row as DocumentItem)?.progress ?? 0"
                      :stroke-width="4"
                      :show-text="false"
                      class="doc-ocr-bar"
                    />
                  </template>
                  <span v-else-if="row.status === 'needs_review'" class="doc-ocr-progress review">
                    低置信 {{ reviewCount(row as DocumentItem) }} 页待校对
                  </span>
                </div>
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
            <el-table-column label="操作" width="196" fixed="right">
              <template #default="{ row }">
                <div class="doc-ops">
                  <el-button
                    v-if="canReview(row as DocumentItem)"
                    link
                    type="warning"
                    size="small"
                    @click="openReview(row as DocumentItem)"
                  >
                    校对{{ reviewCount(row as DocumentItem) ? `（${reviewCount(row as DocumentItem)}）` : '' }}
                  </el-button>
                  <el-button
                    v-if="canRetryOcr(row as DocumentItem)"
                    link
                    type="primary"
                    size="small"
                    :loading="retryingOcr.has(row.document_id)"
                    @click="retryOcr(row as DocumentItem)"
                  >
                    重试 OCR
                  </el-button>
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

    <el-dialog
      v-model="reviewVisible"
      width="94%"
      class="ocr-dialog"
      :close-on-click-modal="false"
      append-to-body
    >
      <template #header>
        <div class="ocr-dialog-head">
          <div>
            <h3 class="ocr-dialog-title">扫描件校对</h3>
            <p class="ocr-dialog-sub">
              {{ reviewDoc?.filename }} · 置信度低于
              {{ Math.round((reviewDetail?.threshold ?? 0.8) * 100) }}% 的页面需人工核对，原文图与识别文本对照修改
            </p>
          </div>
          <el-tag v-if="pendingReviewCount" type="warning" effect="light">待校对 {{ pendingReviewCount }} 页</el-tag>
          <el-tag v-else type="success" effect="light">全部已校对</el-tag>
        </div>
      </template>

      <div class="ocr-review">
        <div class="ocr-review-toolbar">
          <el-button size="small" :disabled="!reviewHasSibling(-1)" @click="moveReviewPage(-1)">上一页</el-button>
          <el-select
            :model-value="reviewPageNo"
            size="small"
            class="ocr-page-select"
            @change="selectReviewPage"
          >
            <el-option
              v-for="page in reviewPages"
              :key="page.page"
              :label="reviewPageLabel(page)"
              :value="page.page"
            />
          </el-select>
          <el-button size="small" :disabled="!reviewHasSibling(1)" @click="moveReviewPage(1)">下一页</el-button>
          <span class="ocr-confidence">
            OCR 置信度 {{ Math.round((currentReviewPage?.confidence ?? 0) * 100) }}%
          </span>
          <el-tag
            size="small"
            effect="plain"
            :type="currentReviewPage?.status === 'confirmed' ? 'success' : currentReviewPage?.status === 'review' || currentReviewPage?.status === 'failed' ? 'warning' : 'info'"
          >
            {{ reviewPageStatusText }}
          </el-tag>
          <span v-if="currentReviewPage?.engine" class="ocr-engine">{{ currentReviewPage.engine }}</span>
        </div>

        <div class="ocr-review-body">
          <div class="ocr-image-pane">
            <img
              v-if="currentReviewPage?.image_url"
              :src="currentReviewPage.image_url"
              :alt="`第 ${currentReviewPage.page} 页原文图`"
            />
            <el-empty v-else description="该页没有原图" :image-size="60" />
            <span class="ocr-image-caption">原文图 · 第 {{ currentReviewPage?.page ?? '-' }} 页 · 200 DPI</span>
          </div>
          <div class="ocr-text-pane">
            <el-input
              v-model="reviewText"
              type="textarea"
              :rows="22"
              resize="none"
              placeholder="识别文本，可直接对照原文图修改；支持 Markdown、表格与 LaTeX 公式"
            />
            <p class="ocr-text-hint">
              保存后按 Markdown 重新切片；所有低置信页标记校对完成后，点击“写回并重新入库”。
            </p>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="ocr-dialog-footer">
          <span v-if="pendingReviewCount" class="ocr-footer-hint">
            还有 {{ pendingReviewCount }} 页待标记校对
          </span>
          <span v-else class="ocr-footer-hint ok">所有低置信页已校对，可写回重新入库</span>
          <div class="ocr-footer-actions">
            <el-button @click="reviewVisible = false">关闭</el-button>
            <el-button :loading="reviewSaving" @click="saveReviewPage(false)">保存草稿</el-button>
            <el-button type="primary" plain :loading="reviewSaving" @click="saveReviewPage(true)">
              保存并标记已校对
            </el-button>
            <el-button
              type="primary"
              :loading="confirming"
              :disabled="pendingReviewCount > 0"
              @click="confirmReview"
            >
              写回并重新入库
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
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

.folder-input {
  display: none;
}

.folder-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.folder-hint {
  font-size: 11px;
  color: var(--faint);
  line-height: 1.5;
}

.folder-drop {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--faint);
  font-size: 11.5px;
  cursor: copy;
}

.folder-drop:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.doc-path {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--faint);
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
  flex-wrap: wrap;
}

.doc-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.doc-ocr-progress {
  font-size: 11px;
  line-height: 1.4;
  color: var(--muted);
}

.doc-ocr-progress.review {
  color: var(--warning);
}

.doc-ocr-bar {
  width: 100%;
}

:global(.ocr-dialog) {
  max-width: 1180px;
}

.ocr-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ocr-dialog-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}

.ocr-dialog-sub {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}

.ocr-review {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ocr-review-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ocr-page-select {
  width: 220px;
}

.ocr-confidence {
  font-size: 12px;
  color: var(--ink-soft);
}

.ocr-engine {
  font-size: 11px;
  color: var(--faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ocr-review-body {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  gap: 14px;
  height: min(58vh, 620px);
  min-height: 380px;
  overflow: hidden;
}

.ocr-image-pane {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
}

.ocr-image-pane img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(21, 32, 43, 0.08);
}

.ocr-image-caption {
  margin-top: 8px;
  font-size: 11px;
  color: var(--faint);
}

.ocr-text-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.ocr-text-pane :deep(.el-textarea) {
  flex: 1;
  min-height: 0;
  display: flex;
}

.ocr-text-pane :deep(.el-textarea__inner) {
  height: 100%;
  line-height: 1.7;
  font-family: inherit;
}

.ocr-text-hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--faint);
}

.ocr-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ocr-footer-hint {
  font-size: 12px;
  color: var(--warning);
}

.ocr-footer-hint.ok {
  color: var(--success, #2f7a4f);
}

.ocr-footer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .ocr-review-body {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    max-height: none;
  }

  .ocr-image-pane {
    max-height: 46vh;
  }
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