<script setup lang="ts">
import { onMounted, ref } from 'vue';

interface DocItem {
  document_id: string;
  filename: string;
  file_type: string;
  size: number;
  subject: string | null;
  status: string;
  chunk_count: number;
  error: string | null;
  created_at: number;
}

const docs = ref<DocItem[]>([]);
const files = ref<File[]>([]);
const subject = ref('数学');
const uploading = ref(false);
const message = ref('');

async function load() {
  const res = await fetch('/api/documents');
  const data = await res.json();
  docs.value = data.documents ?? [];
}

function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  files.value = [...(input.files ?? [])];
}

async function upload() {
  if (files.value.length === 0) return;
  uploading.value = true;
  message.value = '';
  const form = new FormData();
  for (const f of files.value) form.append('file', f);
  form.append('subject', subject.value);
  try {
    const res = await fetch('/api/documents', { method: 'POST', body: form });
    const data = await res.json();
    if (res.status === 207) {
      message.value = (data.results as { filename: string; status: string; message?: string }[])
        .map((r) => `${r.filename}: ${r.status}${r.message ? `（${r.message}）` : ''}`)
        .join('；');
    } else if (!res.ok) {
      message.value = data.message ?? '上传失败';
    } else {
      message.value = `${data.filename} 解析成功，${data.chunk_count} 个切片，正在向量化…`;
    }
    files.value = [];
    await load();
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
  } finally {
    uploading.value = false;
  }
}

async function reindex(doc: DocItem) {
  message.value = `正在重新向量化 ${doc.filename}…`;
  const res = await fetch(`/api/documents/${doc.document_id}/index`, { method: 'POST' });
  const data = await res.json();
  message.value = data.chunk_count ? `${doc.filename} 已入库（${data.chunk_count} 切片）` : data.message;
  await load();
}

async function remove(doc: DocItem) {
  await fetch(`/api/documents/${doc.document_id}`, { method: 'DELETE' });
  await load();
}

onMounted(load);

function statusText(s: string) {
  return (
    { uploaded: '已上传', parsed: '已解析', indexing: '向量化中', indexed: '已入库', failed: '失败' }[s] ?? s
  );
}
</script>

<template>
  <main class="docs-page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>资料库</h2>
      <router-link to="/chat" class="back">对话 →</router-link>
    </header>

    <section class="uploader">
      <input type="file" multiple accept=".pdf,.docx,.doc,.txt,.md,.markdown" @change="pick" />
      <label>
        学科
        <input v-model="subject" class="subject" placeholder="数学 / 化学 / 英语…" />
      </label>
      <button class="primary" :disabled="uploading || files.length === 0" @click="upload">
        {{ uploading ? '上传中…' : `上传 ${files.length || ''} 个文件` }}
      </button>
      <p v-if="message" class="msg">{{ message }}</p>
    </section>

    <table class="doc-table">
      <thead>
        <tr>
          <th>文件名</th><th>学科</th><th>状态</th><th>切片</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in docs" :key="d.document_id">
          <td>{{ d.filename }}</td>
          <td>{{ d.subject ?? '-' }}</td>
          <td>
            <span :class="['tag', d.status]">{{ statusText(d.status) }}</span>
            <span v-if="d.error" class="err">{{ d.error }}</span>
          </td>
          <td>{{ d.chunk_count }}</td>
          <td class="ops">
            <button class="ghost" @click="reindex(d)">重新灌库</button>
            <button class="ghost danger" @click="remove(d)">删除</button>
          </td>
        </tr>
        <tr v-if="docs.length === 0">
          <td colspan="5" class="empty">还没有上传资料，支持 PDF / Word / TXT / Markdown</td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
.docs-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 20px;
}
.head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.head h2 {
  flex: 1;
  margin: 0;
  font-size: 20px;
}
.back {
  color: #2563eb;
  text-decoration: none;
}
.uploader {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  margin: 18px 0;
}
.subject {
  margin-left: 6px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 4px 8px;
}
button {
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
button.primary {
  background: #2563eb;
  color: #fff;
}
button.primary:disabled {
  background: #93c5fd;
}
button.ghost {
  background: #f3f4f6;
  padding: 5px 10px;
}
button.danger {
  color: #dc2626;
}
.msg {
  width: 100%;
  margin: 0;
  color: #374151;
}
.doc-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
}
.doc-table th,
.doc-table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f1f3;
  font-size: 14px;
}
.tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3f4f6;
  font-size: 12px;
}
.tag.indexed {
  background: #dcfce7;
  color: #15803d;
}
.tag.failed {
  background: #fee2e2;
  color: #b91c1c;
}
.tag.parsed,
.tag.indexing {
  background: #fef3c7;
  color: #92400e;
}
.err {
  color: #b91c1c;
  font-size: 12px;
  margin-left: 8px;
}
.ops {
  display: flex;
  gap: 8px;
}
.empty {
  text-align: center;
  color: #6b7280;
}
</style>