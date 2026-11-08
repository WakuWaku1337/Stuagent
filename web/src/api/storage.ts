export interface StorageBreakdown {
  label: string;
  count: number;
  bytes: number;
}

export interface OrphanItem {
  type: 'media' | 'media_file' | 'document_file';
  name: string;
  bytes: number;
  created_at: number;
}

export interface MissingFileItem {
  type: 'media' | 'document';
  name: string;
  size: number;
}

export interface CleanupHistoryItem {
  cleanup_id: string;
  mode: string;
  media_removed: number;
  files_removed: number;
  bytes_freed: number;
  created_at: number;
}

export interface StorageQuota {
  limit_mb: number;
  used_bytes: number;
  media_bytes: number;
  documents_bytes: number;
  percent: number;
  status: 'unlimited' | 'ok' | 'warning' | 'critical' | 'exceeded';
  message: string;
}

export interface StorageStats {
  generated_at: number;
  paths: { uploads: string; media: string; database: string };
  quota: StorageQuota;
  media: {
    count: number;
    bytes: number;
    referenced: number;
    orphan_count: number;
    orphan_bytes: number;
    missing_files: number;
    by_mime: StorageBreakdown[];
  };
  documents: {
    count: number;
    bytes: number;
    missing_files: number;
    by_type: StorageBreakdown[];
  };
  disk: {
    files: number;
    bytes: number;
    untracked_count: number;
    untracked_bytes: number;
  };
  database: { bytes: number };
  orphans: {
    items: OrphanItem[];
    total_count: number;
    total_bytes: number;
    missing: MissingFileItem[];
    capped: boolean;
  };
  cleanup: {
    retention_days: number;
    schedule_hours: number;
    last_run_at: number | null;
    history: CleanupHistoryItem[];
  };
}

export interface CleanupResult {
  mode: 'orphans' | 'retention';
  dry_run: boolean;
  retention_days: number;
  scanned_at: number;
  candidates: number;
  candidate_bytes: number;
  items: OrphanItem[];
  removed_media: number;
  removed_files: number;
  freed_bytes: number;
  skipped: number;
  failures: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `请求失败（${res.status}）`);
  }
  return data as T;
}

export function fetchStorage(): Promise<StorageStats> {
  return request<StorageStats>('/api/media/storage');
}

export function runCleanup(body: {
  mode: 'orphans' | 'retention';
  olderThanDays?: number;
  dryRun?: boolean;
}): Promise<CleanupResult> {
  return request<CleanupResult>('/api/media/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
