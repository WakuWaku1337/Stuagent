<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  CircleCheck,
  Delete,
  FolderOpened,
  Odometer,
  Picture,
  PieChart,
  Refresh,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import MetricCard from '../components/MetricCard.vue';
import {
  fetchStorage,
  runCleanup,
  type CleanupResult,
  type OrphanItem,
  type StorageQuota,
  type StorageStats,
} from '../api/storage';

const stats = ref<StorageStats | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const mode = ref<'orphans' | 'retention'>('orphans');
const retentionDays = ref(30);
const previewing = ref(false);
const cleaning = ref(false);
const preview = ref<CleanupResult | null>(null);
const lastResult = ref<CleanupResult | null>(null);
let loadedOnce = false;

const statusMeta: Record<StorageQuota['status'], { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  unlimited: { label: '未设上限', type: 'info' },
  ok: { label: '空间正常', type: 'success' },
  warning: { label: '接近上限', type: 'warning' },
  critical: { label: '空间紧张', type: 'danger' },
  exceeded: { label: '已超配额', type: 'danger' },
};

const quota = computed(() => stats.value?.quota ?? null);
const currentStatus = computed(() => (quota.value ? statusMeta[quota.value.status] : statusMeta.ok));
const missingCount = computed(
  () => (stats.value?.media.missing_files ?? 0) + (stats.value?.documents.missing_files ?? 0),
);
const quotaTone = computed<'ink' | 'accent' | 'success' | 'warning'>(() => {
  if (!quota.value) return 'ink';
  return quota.value.status === 'ok' ? 'success' : quota.value.status === 'unlimited' ? 'ink' : 'warning';
});
const quotaHint = computed(() => {
  if (!quota.value) return '读取配额中';
  return quota.value.limit_mb
    ? `上限 ${quota.value.limit_mb} MB · 由 STORAGE_QUOTA_MB 配置`
    : '未设置容量上限，可在环境变量中配置';
});

const quotaBase = computed(() => {
  const data = stats.value;
  if (!data) return 1;
  const limitBytes = data.quota.limit_mb * 1024 * 1024;
  return limitBytes > 0 ? limitBytes : Math.max(1, data.quota.used_bytes);
});
const mediaShare = computed(() =>
  Math.min(100, ((quota.value?.media_bytes ?? 0) / quotaBase.value) * 100),
);
const docsShare = computed(() =>
  Math.min(100, ((quota.value?.documents_bytes ?? 0) / quotaBase.value) * 100),
);
const usedShare = computed(() => Math.min(100, mediaShare.value + docsShare.value));

const itemLabels: Record<OrphanItem['type'], string> = {
  media: '图片记录',
  media_file: '图片文件',
  document_file: '资料文件',
};

const cleanupPreview = computed(() => (preview.value?.items ?? []).slice(0, 6));

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  const text = value >= 100 ? Math.round(value).toString() : value.toFixed(value >= 10 ? 1 : 2);
  return `${text.replace(/\.0+$/, '')} ${units[index]}`;
}

function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function barWidth(bytes: number, total: number): string {
  return total > 0 ? `${Math.max(2, Math.round((bytes / total) * 100))}%` : '0%';
}

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true;
  errorMessage.value = '';
  try {
    const data = await fetchStorage();
    stats.value = data;
    if (!loadedOnce) {
      retentionDays.value = data.cleanup.retention_days;
      loadedOnce = true;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function payload(dryRun: boolean) {
  return {
    mode: mode.value,
    ...(mode.value === 'retention' ? { olderThanDays: retentionDays.value } : {}),
    dryRun,
  };
}

async function scan(): Promise<void> {
  previewing.value = true;
  errorMessage.value = '';
  lastResult.value = null;
  try {
    preview.value = await runCleanup(payload(true));
    if (preview.value.candidates === 0) {
      ElMessage.info('当前没有可回收的文件');
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    previewing.value = false;
  }
}

async function cleanup(): Promise<void> {
  if (cleaning.value) return;
  errorMessage.value = '';
  try {
    const check = await runCleanup(payload(true));
    preview.value = check;
    if (check.candidates === 0) {
      ElMessage.info('当前没有可回收的文件');
      return;
    }
    await ElMessageBox.confirm(
      `将删除 ${check.candidates} 个未被引用的文件，释放约 ${formatBytes(check.candidate_bytes)}。清理后无法恢复。`,
      '确认清理',
      { type: 'warning', confirmButtonText: '开始清理', cancelButtonText: '取消' },
    );
    cleaning.value = true;
    const result = await runCleanup(payload(false));
    lastResult.value = result;
    preview.value = null;
    ElMessage.success(
      `已释放 ${formatBytes(result.freed_bytes)}，移除图片记录 ${result.removed_media} 个、文件 ${result.removed_files} 个`,
    );
    await load(true);
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    cleaning.value = false;
  }
}

watch([mode, retentionDays], () => {
  preview.value = null;
  lastResult.value = null;
});

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page storage-page" v-loading="loading">
    <header class="storage-head">
      <div>
        <h1 class="storage-title">存储治理</h1>
        <p class="storage-sub">
          查看图片与资料的磁盘占用，回收不再被会话引用的文件。扫描与清理都在本机完成。
        </p>
      </div>
      <div class="storage-actions">
        <span v-if="stats" class="scan-time">扫描于 {{ formatTime(stats.generated_at) }}</span>
        <el-button :icon="Refresh" :loading="loading" @click="load()">重新扫描</el-button>
      </div>
    </header>

    <el-alert
      v-if="errorMessage"
      class="storage-error"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
    />

    <section class="metric-grid storage-metrics">
      <MetricCard
        label="已用容量"
        :value="formatBytes(stats?.quota.used_bytes ?? 0)"
        :icon="PieChart"
        tone="accent"
        :hint="`图片 ${formatBytes(stats?.quota.media_bytes ?? 0)} · 资料 ${formatBytes(stats?.quota.documents_bytes ?? 0)}`"
      />
      <MetricCard
        label="配额占用"
        :value="stats?.quota.percent ?? 0"
        suffix="%"
        :icon="Odometer"
        :tone="quotaTone"
        :hint="quotaHint"
      />
      <MetricCard
        label="图片媒体"
        :value="stats?.media.count ?? 0"
        suffix="张"
        :icon="Picture"
        tone="ink"
        :hint="`孤儿 ${stats?.media.orphan_count ?? 0} 张 · ${formatBytes(stats?.media.orphan_bytes ?? 0)}`"
      />
      <MetricCard
        label="可回收文件"
        :value="formatBytes(stats?.orphans.total_bytes ?? 0)"
        :icon="Delete"
        :tone="(stats?.orphans.total_count ?? 0) > 0 ? 'warning' : 'success'"
        :hint="`${stats?.orphans.total_count ?? 0} 个未被引用的文件`"
      />
    </section>

    <section class="quota-band" :class="`is-${quota?.status ?? 'ok'}`">
      <div class="quota-band-head">
        <div class="quota-heading">
          <span class="quota-icon"><el-icon><FolderOpened /></el-icon></span>
          <div>
            <p class="quota-label">容量配额</p>
            <p class="quota-message">{{ quota?.message ?? '正在读取存储状态' }}</p>
          </div>
        </div>
        <el-tag :type="currentStatus.type" effect="plain">{{ currentStatus.label }}</el-tag>
      </div>
      <div
        class="quota-rail"
        role="img"
        :aria-label="`已用 ${formatBytes(stats?.quota.used_bytes ?? 0)}，其中图片 ${formatBytes(stats?.quota.media_bytes ?? 0)}，资料 ${formatBytes(stats?.quota.documents_bytes ?? 0)}`"
      >
        <span class="quota-fill media" :style="{ width: `${mediaShare}%` }" />
        <span class="quota-fill docs" :style="{ width: `${docsShare}%` }" />
        <span v-if="quota?.limit_mb" class="quota-mark" :style="{ left: '80%' }" />
      </div>
      <div class="quota-legend">
        <span><i class="legend-dot media" />图片媒体 <b>{{ formatBytes(quota?.media_bytes ?? 0) }}</b></span>
        <span><i class="legend-dot docs" />教材资料 <b>{{ formatBytes(quota?.documents_bytes ?? 0) }}</b></span>
        <span class="quota-total">
          {{ formatBytes(stats?.quota.used_bytes ?? 0) }} / {{ quota?.limit_mb ? `${quota.limit_mb} MB` : '未设上限' }}
        </span>
      </div>
      <p v-if="quota?.limit_mb" class="quota-mark-note">竖线为 80% 预警位置，占用 {{ usedShare.toFixed(0) }}%</p>
    </section>

    <section class="columns storage-columns">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">占用构成</h2>
            <p class="panel-sub">按文件类型拆分已登记的图片与资料</p>
          </div>
          <span class="panel-count">{{ (stats?.media.count ?? 0) + (stats?.documents.count ?? 0) }} 个文件</span>
        </div>
        <div class="panel-body">
          <div class="break-group media">
            <p class="break-title">图片媒体</p>
            <div v-for="item in stats?.media.by_mime ?? []" :key="item.label" class="break-row">
              <div class="break-head">
                <span class="break-label">{{ item.label }}</span>
                <span class="break-meta">{{ item.count }} 张 · {{ formatBytes(item.bytes) }}</span>
              </div>
              <span class="break-bar">
                <i :style="{ width: barWidth(item.bytes, stats?.media.bytes ?? 0) }" />
              </span>
            </div>
            <p v-if="!(stats?.media.by_mime ?? []).length" class="inline-empty">还没有上传图片</p>
          </div>

          <div class="break-group docs">
            <p class="break-title">教材资料</p>
            <div v-for="item in stats?.documents.by_type ?? []" :key="item.label" class="break-row">
              <div class="break-head">
                <span class="break-label">{{ item.label }}</span>
                <span class="break-meta">{{ item.count }} 份 · {{ formatBytes(item.bytes) }}</span>
              </div>
              <span class="break-bar">
                <i :style="{ width: barWidth(item.bytes, stats?.documents.bytes ?? 0) }" />
              </span>
            </div>
            <p v-if="!(stats?.documents.by_type ?? []).length" class="inline-empty">还没有上传资料</p>
          </div>

          <div class="storage-foot">
            <p>上传目录 <code>{{ stats?.paths.uploads ?? '—' }}</code></p>
            <p>
              数据库 {{ formatBytes(stats?.database.bytes ?? 0) }} · 磁盘共
              {{ stats?.disk.files ?? 0 }} 个文件（{{ formatBytes(stats?.disk.bytes ?? 0) }}）
            </p>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">孤儿文件回收</h2>
            <p class="panel-sub">未被任何会话引用，或没有登记记录的图片与上传文件</p>
          </div>
        </div>
        <div class="panel-body">
          <el-alert
            v-if="missingCount"
            class="missing-alert"
            type="warning"
            :closable="false"
            show-icon
            :title="`有 ${missingCount} 条记录对应的文件已缺失`"
            description="记录与磁盘文件不一致，建议检查上传目录或删除对应记录。"
          />

          <div class="cleanup-form">
            <el-segmented
              v-model="mode"
              :options="[
                { label: '立即回收孤儿', value: 'orphans' },
                { label: '按保留期清理', value: 'retention' },
              ]"
              block
            />
            <div v-if="mode === 'retention'" class="retention-row">
              <span>保留最近</span>
              <el-select v-model="retentionDays" size="small" style="width: 112px">
                <el-option :value="7" label="7 天" />
                <el-option :value="30" label="30 天" />
                <el-option :value="90" label="90 天" />
                <el-option :value="180" label="180 天" />
              </el-select>
              <span>的孤儿文件</span>
            </div>
          </div>

          <div class="cleanup-actions">
            <el-button :loading="previewing" :disabled="cleaning" @click="scan">预检</el-button>
            <el-button type="primary" :loading="cleaning" :disabled="previewing" @click="cleanup">
              清理
            </el-button>
          </div>

          <p class="cleanup-note">
            只处理未被引用的文件；会话或消息仍在引用的图片不会被删除。清理不可撤销，建议先预检。
          </p>

          <div v-if="lastResult" class="cleanup-result">
            <el-icon><CircleCheck /></el-icon>
            <p>
              上次清理释放 <b>{{ formatBytes(lastResult.freed_bytes) }}</b>，移除图片记录
              {{ lastResult.removed_media }} 个、文件 {{ lastResult.removed_files }} 个。
            </p>
          </div>

          <div v-else-if="preview" class="preview">
            <div class="preview-head">
              <span>{{ preview.candidates ? `发现 ${preview.candidates} 个可回收文件` : '没有可回收文件' }}</span>
              <b v-if="preview.candidates" class="numeric">{{ formatBytes(preview.candidate_bytes) }}</b>
            </div>
            <ul v-if="cleanupPreview.length" class="preview-list">
              <li v-for="(item, index) in cleanupPreview" :key="`${item.type}-${index}`">
                <el-tag size="small" type="info" effect="plain">{{ itemLabels[item.type] }}</el-tag>
                <span class="preview-name" :title="item.name">{{ item.name }}</span>
                <span class="preview-size numeric">{{ formatBytes(item.bytes) }}</span>
              </li>
            </ul>
            <p v-if="preview.candidates > cleanupPreview.length" class="preview-note">
              仅展示前 {{ cleanupPreview.length }} 项，执行时会处理全部命中项。
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="columns storage-bottom">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">清理记录</h2>
            <p class="panel-sub">最近 8 次手动或自动清理</p>
          </div>
        </div>
        <div class="panel-body">
          <el-table :data="stats?.cleanup.history ?? []" size="small" empty-text="还没有清理记录">
            <el-table-column label="时间" width="118">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="方式" width="92">
              <template #default="{ row }">{{ row.mode === 'retention' ? '按保留期' : '立即回收' }}</template>
            </el-table-column>
            <el-table-column label="移除" min-width="118">
              <template #default="{ row }">
                {{ row.media_removed }} 图 · {{ row.files_removed }} 文件
              </template>
            </el-table-column>
            <el-table-column label="释放" width="92" align="right">
              <template #default="{ row }">
                <span class="numeric">{{ formatBytes(row.bytes_freed) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">清理策略</h2>
            <p class="panel-sub">通过环境变量调整，重启服务后生效</p>
          </div>
        </div>
        <div class="panel-body policy">
          <div class="policy-row">
            <span>自动周期</span>
            <b>{{ stats?.cleanup.schedule_hours ? `每 ${stats.cleanup.schedule_hours} 小时` : '已关闭' }}</b>
          </div>
          <div class="policy-row">
            <span>默认保留期</span>
            <b>{{ stats?.cleanup.retention_days ?? 30 }} 天</b>
          </div>
          <div class="policy-row">
            <span>上传配额</span>
            <b>{{ quota?.limit_mb ? `${quota.limit_mb} MB` : '未设置' }}</b>
          </div>
          <div class="policy-row">
            <span>最近清理</span>
            <b>{{ formatTime(stats?.cleanup.last_run_at) }}</b>
          </div>
          <p class="policy-code">
            <code>STORAGE_QUOTA_MB</code> 配额 · <code>STORAGE_RETENTION_DAYS</code> 保留期 ·
            <code>STORAGE_CLEANUP_HOURS</code> 周期（0 关闭）
          </p>
          <p class="policy-note">
            删除会话时会立即回收仅被该会话引用的图片；删除资料会同时移除上传的原始文件。
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.storage-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.storage-title {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.storage-sub {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--muted);
  max-width: 640px;
}

.storage-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.scan-time {
  font-size: 11.5px;
  color: var(--faint);
  white-space: nowrap;
}

.storage-error {
  margin-bottom: 16px;
}

.storage-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.quota-band {
  margin-top: 18px;
  padding: 18px 22px 16px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.quota-band.is-warning {
  border-color: #ead3b4;
}

.quota-band.is-critical,
.quota-band.is-exceeded {
  border-color: #e9c7c4;
}

.quota-band-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.quota-heading {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.quota-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 17px;
  flex: none;
}

.quota-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.quota-message {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.quota-rail {
  position: relative;
  display: flex;
  height: 12px;
  margin-top: 16px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--paper-deep);
}

.quota-fill {
  height: 100%;
  transition: width 0.35s ease;
}

.quota-fill.media {
  background: var(--accent);
}

.quota-fill.docs {
  background: #5fae8c;
}

.quota-mark {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--ink);
  opacity: 0.5;
}

.quota-legend {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--muted);
}

.quota-legend b {
  margin-left: 4px;
  font-weight: 600;
  color: var(--ink-soft);
}

.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 2px;
  vertical-align: 0;
}

.legend-dot.media {
  background: var(--accent);
}

.legend-dot.docs {
  background: #5fae8c;
}

.quota-total {
  margin-left: auto;
  color: var(--faint);
}

.quota-mark-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--faint);
}

.storage-columns {
  margin-top: 18px;
}

.panel-count {
  font-size: 11.5px;
  color: var(--faint);
  white-space: nowrap;
}

.break-group + .break-group {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

.break-title {
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-soft);
}

.break-row + .break-row {
  margin-top: 12px;
}

.break-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
  font-size: 12.5px;
}

.break-label {
  color: var(--ink-soft);
}

.break-meta {
  color: var(--faint);
  font-size: 11.5px;
}

.break-bar {
  display: block;
  height: 7px;
  border-radius: 999px;
  background: var(--paper-deep);
  overflow: hidden;
}

.break-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.break-group.media .break-bar i {
  background: var(--accent);
}

.break-group.docs .break-bar i {
  background: #5fae8c;
}

.inline-empty {
  padding: 10px 0 4px;
  text-align: left;
  font-size: 12px;
  color: var(--faint);
}

.storage-foot {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--faint);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.storage-foot code {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-size: 10.5px;
  color: var(--muted);
  word-break: break-all;
}

.missing-alert {
  margin-bottom: 14px;
}

.cleanup-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.retention-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}

.cleanup-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.cleanup-note {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.55;
}

.cleanup-result {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  margin-top: 14px;
  padding: 11px 13px;
  border: 1px solid #cfe4d8;
  border-radius: var(--radius-sm);
  background: var(--success-soft);
  color: var(--success);
  font-size: 12px;
}

.cleanup-result .el-icon {
  margin-top: 2px;
  flex: none;
}

.preview {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.preview-head b {
  font-family: var(--font-num);
  color: var(--warning);
}

.preview-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}

.preview-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 11.5px;
}

.preview-list li:last-child {
  border-bottom: 0;
}

.preview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-soft);
}

.preview-size {
  color: var(--faint);
  white-space: nowrap;
}

.preview-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--faint);
}

.storage-bottom {
  margin-top: 18px;
}

.policy-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--muted);
}

.policy-row b {
  font-weight: 600;
  color: var(--ink-soft);
}

.policy-code {
  margin-top: 12px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--faint);
}

.policy-code code {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--paper);
  color: var(--muted);
}

.policy-note {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.55;
}

@media (max-width: 1280px) {
  .storage-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .storage-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .storage-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .storage-title {
    font-size: 21px;
  }

  .storage-actions {
    width: 100%;
    justify-content: space-between;
  }

  .quota-band {
    padding: 16px;
  }

  .quota-total {
    margin-left: 0;
  }
}
</style>
