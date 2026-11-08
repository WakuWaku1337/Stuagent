import { db } from '../store.ts';

export type QuotaStatus = 'unlimited' | 'ok' | 'warning' | 'critical' | 'exceeded';

export interface StorageLimits {
  quotaMb: number;
  retentionDays: number;
  cleanupHours: number;
  warningPercent: number;
  criticalPercent: number;
}

export interface QuotaSummary {
  limit_mb: number;
  used_bytes: number;
  media_bytes: number;
  documents_bytes: number;
  percent: number;
  status: QuotaStatus;
  message: string;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function storageLimits(): StorageLimits {
  return {
    quotaMb: clamp(Math.round(envNumber('STORAGE_QUOTA_MB', 1024)), 0, 1_000_000),
    retentionDays: clamp(Math.round(envNumber('STORAGE_RETENTION_DAYS', 30)), 1, 3650),
    cleanupHours: clamp(Math.round(envNumber('STORAGE_CLEANUP_HOURS', 24)), 0, 8760),
    warningPercent: 80,
    criticalPercent: 95,
  };
}

export function trackedStorageBytes(): { media: number; documents: number; total: number } {
  const media = (
    db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM media').get() as { n: number }
  ).n;
  const documents = (
    db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM documents').get() as { n: number }
  ).n;
  return { media, documents, total: media + documents };
}

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function describeBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${toMb(bytes)}MB`;
}

export function quotaSummary(): QuotaSummary {
  const { quotaMb } = storageLimits();
  const used = trackedStorageBytes();
  if (quotaMb === 0) {
    return {
      limit_mb: 0,
      used_bytes: used.total,
      media_bytes: used.media,
      documents_bytes: used.documents,
      percent: 0,
      status: 'unlimited',
      message: `未设置容量上限，当前占用 ${toMb(used.total)}MB`,
    };
  }
  const limitBytes = quotaMb * 1024 * 1024;
  const rawPercent = (used.total / limitBytes) * 100;
  const percent = Math.round(rawPercent * 10) / 10;
  let status: QuotaStatus = 'ok';
  if (rawPercent >= 100) status = 'exceeded';
  else if (rawPercent >= storageLimits().criticalPercent) status = 'critical';
  else if (rawPercent >= storageLimits().warningPercent) status = 'warning';

  const message =
    status === 'exceeded'
      ? `存储占用 ${percent}%，已超过 ${quotaMb}MB 配额，新的上传会被拒绝，请先清理`
      : status === 'critical'
        ? `存储占用 ${percent}%，接近 ${quotaMb}MB 配额，请尽快清理`
        : status === 'warning'
          ? `存储占用 ${percent}%，已达 ${quotaMb}MB 配额的 80%，建议清理不再引用的文件`
          : `存储占用 ${percent}%，配额 ${quotaMb}MB`;
  return {
    limit_mb: quotaMb,
    used_bytes: used.total,
    media_bytes: used.media,
    documents_bytes: used.documents,
    percent,
    status,
    message,
  };
}

export function checkStorageQuota(additionalBytes: number): { allowed: boolean; message: string } {
  const quota = quotaSummary();
  if (quota.limit_mb === 0) return { allowed: true, message: quota.message };
  const limitBytes = quota.limit_mb * 1024 * 1024;
  if (quota.used_bytes + additionalBytes <= limitBytes) return { allowed: true, message: quota.message };
  return {
    allowed: false,
    message: `存储配额不足：已用 ${describeBytes(quota.used_bytes)} / ${quota.limit_mb}MB，本次需要 ${describeBytes(additionalBytes)}。请先清理存储`,
  };
}
