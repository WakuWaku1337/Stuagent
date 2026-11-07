<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { MagicStick, Monitor, Reading } from '@element-plus/icons-vue';
import { api, type CoursewareItem } from '../api/data';

const items = ref<CoursewareItem[]>([]);
const topic = ref('勾股定理');
const subject = ref('数学');
const current = ref<CoursewareItem | null>(null);
const loading = ref(false);
const message = ref('');

async function load() {
  try {
    const data = await api.courseware();
    items.value = data.items;
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  }
}

async function generate() {
  if (!topic.value.trim()) {
    message.value = '请填写课件主题';
    return;
  }
  loading.value = true;
  message.value = '';
  try {
    const res = await fetch('/api/courseware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic.value, subject: subject.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? '生成失败');
    message.value = `已生成《${data.title}》（${data.source === 'llm' ? '模型生成' : '内置模板'}）`;
    ElMessage.success('课件已生成');
    await load();
    current.value = items.value.find((i) => i.courseware_id === data.courseware_id) ?? null;
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  } finally {
    loading.value = false;
  }
}

async function remove(item: CoursewareItem) {
  try {
    const res = await fetch(`/api/courseware/${item.courseware_id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    if (current.value?.courseware_id === item.courseware_id) current.value = null;
    ElMessage.success('课件已删除');
    await load();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    ElMessage.error(message.value);
  }
}

onMounted(async () => {
  await load();
  const open = new URLSearchParams(location.search).get('open');
  if (open) {
    current.value = items.value.find((i) => i.courseware_id === open) ?? items.value[0] ?? null;
  } else {
    current.value = items.value[0] ?? null;
  }
});
</script>

<template>
  <div class="page">
    <section class="panel generate-panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">生成交互课件</h2>
          <p class="panel-sub">单文件 HTML，包含 canvas 交互与滑块，可离线打开</p>
        </div>
        <el-icon class="generate-icon"><MagicStick /></el-icon>
      </div>
      <div class="panel-body">
        <div class="generate-form">
          <div class="gen-field grow">
            <label class="field-label">主题</label>
            <el-input v-model="topic" placeholder="例如：勾股定理" @keyup.enter="generate" />
          </div>
          <div class="gen-field">
            <label class="field-label">学科</label>
            <el-input v-model="subject" placeholder="数学" />
          </div>
          <el-button type="primary" :icon="MagicStick" :loading="loading" @click="generate">
            {{ loading ? '正在生成…' : '生成课件' }}
          </el-button>
        </div>
        <el-alert
          v-if="message"
          class="generate-message"
          :title="message"
          type="info"
          :closable="false"
          show-icon
        />
        <p class="generate-hint">生成后的课件在沙箱 iframe 中预览，脚本仅限课件自身运行。</p>
      </div>
    </section>

    <section class="section courseware-layout">
      <div class="panel list-panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">课件库</h2>
            <p class="panel-sub">共 {{ items.length }} 个</p>
          </div>
        </div>
        <div class="panel-body">
          <button
            v-for="item in items"
            :key="item.courseware_id"
            class="cw-item"
            :class="{ active: current?.courseware_id === item.courseware_id }"
            @click="current = item"
          >
            <span class="cw-icon"><el-icon><Reading /></el-icon></span>
            <span class="cw-main">
              <span class="cw-title">{{ item.title }}</span>
              <span class="cw-meta">{{ item.subject ?? '未分科' }} · {{ item.source === 'llm' ? '模型生成' : '内置模板' }}</span>
            </span>
            <el-popconfirm
              title="删除这个课件？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm="remove(item)"
            >
              <template #reference>
                <span class="cw-delete" @click.stop>删除</span>
              </template>
            </el-popconfirm>
          </button>
          <el-empty
            v-if="items.length === 0"
            description="还没有课件，填写主题后生成"
            :image-size="76"
          />
        </div>
      </div>

      <div class="panel preview-panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">{{ current?.title ?? '课件预览' }}</h2>
            <p class="panel-sub">
              {{ current ? `${current.subject ?? '未分科'} · ${current.source === 'llm' ? '模型生成' : '内置模板'}` : '从左侧选择课件' }}
            </p>
          </div>
          <a
            v-if="current"
            class="preview-link"
            :href="`/api/courseware/${current.courseware_id}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            <el-icon><Monitor /></el-icon>
            新窗口打开
          </a>
        </div>
        <div class="panel-body preview-body">
          <iframe
            v-if="current"
            :key="current.courseware_id"
            :src="`/api/courseware/${current.courseware_id}`"
            class="cw-frame"
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"
            title="交互课件预览"
          ></iframe>
          <el-empty
            v-else
            description="选择一个课件开始预览。生成后可直接在此操作 canvas 与滑块。"
            :image-size="90"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.generate-icon {
  font-size: 22px;
  color: var(--faint);
}

.generate-form {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}

.gen-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 180px;
}

.gen-field.grow {
  flex: 1;
  min-width: 240px;
  width: auto;
}

.field-label {
  font-size: 12px;
  color: var(--muted);
}

.generate-message {
  margin-top: 14px;
}

.generate-hint {
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--faint);
}

.courseware-layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.cw-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  margin: 0 0 4px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.cw-item:hover {
  background: var(--paper);
}

.cw-item.active {
  border-color: #d8e1fc;
  background: var(--accent-soft);
}

.cw-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 7px;
  background: #fff;
  border: 1px solid var(--line);
  color: var(--muted);
  flex: none;
}

.cw-item.active .cw-icon {
  color: var(--accent);
  border-color: #c3d0fa;
}

.cw-main {
  flex: 1;
  min-width: 0;
}

.cw-title {
  display: block;
  font-size: 13px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-meta {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  color: var(--faint);
}

.cw-delete {
  flex: none;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--faint);
  cursor: pointer;
}

.cw-delete:hover {
  color: var(--danger);
}

.preview-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--accent);
}

.preview-body {
  padding-top: 4px;
}

.cw-frame {
  width: 100%;
  height: 660px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}

@media (max-width: 1100px) {
  .courseware-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .cw-frame {
    height: 520px;
  }
}
</style>