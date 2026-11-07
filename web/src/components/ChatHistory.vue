<script setup lang="ts">
import { computed } from 'vue';
import { MoreFilled, Plus, Search, Top } from '@element-plus/icons-vue';
import type { ConversationItem } from '../api/conversations';

const props = defineProps<{
  conversations: ConversationItem[];
  currentId: string;
  loading: boolean;
  error: string;
  search: string;
  streaming: boolean;
}>();

const emit = defineEmits<{
  'update:search': [value: string];
  create: [];
  select: [id: string];
  rename: [item: ConversationItem];
  pin: [item: ConversationItem];
  remove: [item: ConversationItem];
}>();

const keyword = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
});

const dayStart = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
})();

const groups = computed(() => {
  const pinned: ConversationItem[] = [];
  const today: ConversationItem[] = [];
  const yesterday: ConversationItem[] = [];
  const earlier: ConversationItem[] = [];
  for (const item of props.conversations) {
    if (item.pinned) pinned.push(item);
    else if (item.updated_at >= dayStart) today.push(item);
    else if (item.updated_at >= dayStart - 86_400_000) yesterday.push(item);
    else earlier.push(item);
  }
  return [
    { label: '置顶', items: pinned },
    { label: '今天', items: today },
    { label: '昨天', items: yesterday },
    { label: '更早', items: earlier },
  ].filter((group) => group.items.length > 0);
});

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  if (timestamp >= dayStart) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function select(id: string) {
  if (props.streaming) return;
  emit('select', id);
}

function onCommand(command: string, item: ConversationItem) {
  if (props.streaming && item.conversation_id === props.currentId) return;
  if (command === 'rename') emit('rename', item);
  if (command === 'pin') emit('pin', item);
  if (command === 'remove') emit('remove', item);
}
</script>

<template>
  <div class="history">
    <div class="history-head">
      <div class="history-title-row">
        <p class="history-title">会话记录</p>
        <el-button
          text
          size="small"
          :icon="Plus"
          :disabled="streaming"
          @click="emit('create')"
        >
          新建
        </el-button>
      </div>
      <el-input
        v-model="keyword"
        size="small"
        :prefix-icon="Search"
        placeholder="搜索会话内容"
        clearable
      />
    </div>

    <div class="history-list">
      <div v-if="loading && conversations.length === 0" class="history-empty">正在加载会话…</div>
      <div v-else-if="error && conversations.length === 0" class="history-empty">{{ error }}</div>
      <div v-else-if="conversations.length === 0" class="history-empty">
        <p>{{ search.trim() ? '没有匹配的会话' : '还没有历史会话' }}</p>
        <p v-if="!search.trim()" class="history-empty-sub">发送第一条消息后会保存在这里。</p>
      </div>

      <div v-for="group in groups" :key="group.label" class="history-group">
        <p class="group-label">{{ group.label }}</p>
        <div
          v-for="item in group.items"
          :key="item.conversation_id"
          class="history-item"
          :class="{ active: item.conversation_id === currentId, locked: streaming }"
          role="button"
          :tabindex="0"
          :aria-current="item.conversation_id === currentId ? 'true' : undefined"
          @click="select(item.conversation_id)"
          @keydown.enter.prevent="select(item.conversation_id)"
          @keydown.space.prevent="select(item.conversation_id)"
        >
          <div class="item-title-row">
            <el-icon v-if="item.pinned" class="item-pin"><Top /></el-icon>
            <span class="item-title">{{ item.title }}</span>
          </div>
          <div class="item-sub-row">
            <span class="item-preview">{{ item.preview || '暂无消息' }}</span>
            <span class="item-time">{{ timeLabel(item.updated_at) }}</span>
          </div>

          <div class="item-actions" @click.stop @keydown.stop>
            <el-dropdown
              trigger="click"
              :disabled="streaming && item.conversation_id === currentId"
              @command="(command: string) => onCommand(command, item)"
            >
              <button class="item-more" type="button" aria-label="会话操作">
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">重命名</el-dropdown-item>
                  <el-dropdown-item command="pin">
                    {{ item.pinned ? '取消置顶' : '置顶' }}
                  </el-dropdown-item>
                  <el-dropdown-item command="remove" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.history-head {
  flex: none;
  padding: 16px 14px 10px;
  border-bottom: 1px solid var(--line);
}

.history-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.history-title {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

.history-head :deep(.el-button) {
  padding: 4px 6px;
  font-size: 12px;
  color: var(--muted);
}

.history-head :deep(.el-button:hover) {
  color: var(--accent);
}

.history-head :deep(.el-input__wrapper) {
  min-height: 30px;
  background: #f7f9f8;
  box-shadow: 0 0 0 1px var(--line) inset;
}

.history-head :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow: 0 0 0 1px var(--accent) inset;
}

.history-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 18px;
}

.history-group {
  margin-top: 6px;
}

.group-label {
  padding: 10px 8px 5px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--faint);
}

.history-item {
  position: relative;
  padding: 9px 30px 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  outline: none;
}

.history-item:hover {
  background: #f5f7f6;
}

.history-item:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.history-item.active {
  background: var(--accent-soft);
}

.history-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.history-item.locked {
  cursor: default;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.item-pin {
  flex: none;
  font-size: 11px;
  color: var(--accent);
}

.item-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-soft);
}

.history-item.active .item-title {
  color: var(--accent-deep);
}

.item-sub-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 3px;
}

.item-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--faint);
}

.item-time {
  flex: none;
  font-size: 10.5px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.item-actions {
  position: absolute;
  top: 5px;
  right: 4px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.history-item:hover .item-actions,
.history-item.active .item-actions,
.item-actions:focus-within {
  opacity: 1;
}

.item-more {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.item-more:hover,
.item-more:focus-visible {
  background: #e9edeb;
  color: var(--ink);
  outline: none;
}

.history-empty {
  padding: 34px 12px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--faint);
}

.history-empty-sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--faint);
}
</style>
