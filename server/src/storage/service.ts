import { randomUUID } from 'node:crypto';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db, dbPath } from '../store.ts';
import { removeMedia } from '../media/service.ts';
import { mediaDir, uploadsDir } from './paths.ts';
import { quotaSummary, storageLimits, type QuotaSummary } from './quota.ts';
import { referencedMediaIds } from './refs.ts';

export type CleanupMode = 'orphans' | 'retention';

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
  media_id?: string;
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

export interface StorageStats {
  generated_at: number;
  paths: { uploads: string; media: string; database: string };
  quota: QuotaSummary;
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
  mode: CleanupMode;
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

interface MediaRowLite {
  media_id: string;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  created_at: number;
}

interface DocRowLite {
  document_id: string;
  filename: string;
  file_type: string;
  size: number;
  created_at: number;
}

interface FileInfo {
  name: string;
  bytes: number;
  mtime: number;
}

const ITEM_CAP = 100;
const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPG 图片',
  'image/png': 'PNG 图片',
  'image/webp': 'WebP 图片',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function listFiles(dir: string): Promise<FileInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: FileInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const info = await stat(join(dir, entry.name)).catch(() => null);
    if (info) files.push({ name: entry.name, bytes: info.size, mtime: info.mtimeMs });
  }
  return files;
}

function breakdown(items: Map<string, StorageBreakdown>): StorageBreakdown[] {
  return [...items.values()].sort((a, b) => b.bytes - a.bytes);
}

async function scanStorage() {
  const mediaRows = db
    .prepare('SELECT media_id, filename, stored_name, mime, size, created_at FROM media')
    .all() as unknown as MediaRowLite[];
  const docRows = db
    .prepare('SELECT document_id, filename, file_type, size, created_at FROM documents')
    .all() as unknown as DocRowLite[];
  const [mediaFiles, rootFiles] = await Promise.all([listFiles(mediaDir), listFiles(uploadsDir)]);
  const referenced = referencedMediaIds();

  const mediaNames = new Set(mediaRows.map((row) => row.stored_name));
  const docNames = new Set(docRows.map((row) => `${row.document_id}.${row.file_type}`));
  const mediaFileNames = new Set(mediaFiles.map((file) => file.name));
  const rootFileNames = new Set(rootFiles.map((file) => file.name));

  const orphanRows = mediaRows.filter((row) => !referenced.has(row.media_id));
  const untrackedMedia = mediaFiles.filter((file) => !mediaNames.has(file.name));
  const untrackedDocs = rootFiles.filter((file) => !docNames.has(file.name));
  const missingMedia = mediaRows.filter((row) => !mediaFileNames.has(row.stored_name));
  const missingDocs = docRows.filter((row) => !rootFileNames.has(`${row.document_id}.${row.file_type}`));

  const mediaBytes = mediaRows.reduce((sum, row) => sum + row.size, 0);
  const docBytes = docRows.reduce((sum, row) => sum + row.size, 0);
  const diskFiles = [...mediaFiles, ...rootFiles];
  const orphanItems: OrphanItem[] = [
    ...orphanRows.map((row) => ({
      type: 'media' as const,
      name: `${row.filename} · ${row.stored_name}`,
      bytes: row.size,
      created_at: row.created_at,
    })),
    ...untrackedMedia.map((file) => ({
      type: 'media_file' as const,
      name: file.name,
      bytes: file.bytes,
      created_at: Math.round(file.mtime),
    })),
    ...untrackedDocs.map((file) => ({
      type: 'document_file' as const,
      name: file.name,
      bytes: file.bytes,
      created_at: Math.round(file.mtime),
    })),
  ];
  const orphanBytes = orphanItems.reduce((sum, item) => sum + item.bytes, 0);

  const mimeMap = new Map<string, StorageBreakdown>();
  for (const row of mediaRows) {
    const label = MIME_LABELS[row.mime] ?? row.mime;
    const entry = mimeMap.get(row.mime) ?? { label, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += row.size;
    mimeMap.set(row.mime, entry);
  }
  const typeMap = new Map<string, StorageBreakdown>();
  for (const row of docRows) {
    const key = (row.file_type || 'other').toUpperCase();
    const entry = typeMap.get(key) ?? { label: key, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += row.size;
    typeMap.set(key, entry);
  }

  return {
    mediaRows,
    docRows,
    mediaFiles,
    rootFiles,
    referenced,
    orphanRows,
    untrackedMedia,
    untrackedDocs,
    missingMedia,
    missingDocs,
    mediaBytes,
    docBytes,
    diskFiles,
    orphanItems,
    orphanBytes,
    byMime: breakdown(mimeMap),
    byType: breakdown(typeMap),
  };
}

function cleanupHistory(limit = 8): CleanupHistoryItem[] {
  return db
    .prepare(
      `SELECT cleanup_id, mode, media_removed, files_removed, bytes_freed, created_at
       FROM storage_cleanups ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as CleanupHistoryItem[];
}

export async function storageStats(): Promise<StorageStats> {
  const scan = await scanStorage();
  const limits = storageLimits();
  const history = cleanupHistory();
  let dbBytes = 0;
  try {
    dbBytes = (await stat(dbPath())).size;
  } catch {
    dbBytes = 0;
  }
  const databaseWal = await stat(`${dbPath()}-wal`).catch(() => null);
  const preview = scan.orphanItems.slice(0, ITEM_CAP);
  return {
    generated_at: Date.now(),
    paths: { uploads: uploadsDir, media: mediaDir, database: dbPath() },
    quota: quotaSummary(),
    media: {
      count: scan.mediaRows.length,
      bytes: scan.mediaBytes,
      referenced: scan.mediaRows.length - scan.orphanRows.length,
      orphan_count: scan.orphanRows.length,
      orphan_bytes: scan.orphanRows.reduce((sum, row) => sum + row.size, 0),
      missing_files: scan.missingMedia.length,
      by_mime: scan.byMime,
    },
    documents: {
      count: scan.docRows.length,
      bytes: scan.docBytes,
      missing_files: scan.missingDocs.length,
      by_type: scan.byType,
    },
    disk: {
      files: scan.diskFiles.length,
      bytes: scan.diskFiles.reduce((sum, file) => sum + file.bytes, 0),
      untracked_count: scan.untrackedMedia.length + scan.untrackedDocs.length,
      untracked_bytes:
        scan.untrackedMedia.reduce((sum, file) => sum + file.bytes, 0) +
        scan.untrackedDocs.reduce((sum, file) => sum + file.bytes, 0),
    },
    database: { bytes: dbBytes + (databaseWal?.size ?? 0) },
    orphans: {
      items: preview,
      total_count: scan.orphanItems.length,
      total_bytes: scan.orphanBytes,
      missing: [
        ...scan.missingMedia.map((row) => ({
          type: 'media' as const,
          name: row.stored_name,
          size: row.size,
        })),
        ...scan.missingDocs.map((row) => ({
          type: 'document' as const,
          name: `${row.document_id}.${row.file_type}`,
          size: row.size,
        })),
      ].slice(0, ITEM_CAP),
      capped: scan.orphanItems.length > ITEM_CAP,
    },
    cleanup: {
      retention_days: limits.retentionDays,
      schedule_hours: limits.cleanupHours,
      last_run_at: history[0]?.created_at ?? null,
      history,
    },
  };
}

export async function runCleanup(
  options: { mode?: CleanupMode; olderThanDays?: number; dryRun?: boolean } = {},
): Promise<CleanupResult> {
  const limits = storageLimits();
  const mode: CleanupMode = options.mode === 'retention' ? 'retention' : 'orphans';
  const days = clamp(Math.round(options.olderThanDays ?? limits.retentionDays), 1, 3650);
  const dryRun = options.dryRun === true;
  const now = Date.now();
  const cutoff = mode === 'retention' ? now - days * 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
  const scan = await scanStorage();

  const candidates: OrphanItem[] = [
    ...scan.orphanRows
      .filter((row) => row.created_at < cutoff)
      .map((row) => ({
        type: 'media' as const,
        name: `${row.filename} · ${row.stored_name}`,
        bytes: row.size,
        created_at: row.created_at,
        media_id: row.media_id,
      })),
    ...scan.untrackedMedia
      .filter((file) => file.mtime < cutoff)
      .map((file) => ({
        type: 'media_file' as const,
        name: file.name,
        bytes: file.bytes,
        created_at: Math.round(file.mtime),
      })),
    ...scan.untrackedDocs
      .filter((file) => file.mtime < cutoff)
      .map((file) => ({
        type: 'document_file' as const,
        name: file.name,
        bytes: file.bytes,
        created_at: Math.round(file.mtime),
      })),
  ];
  const candidateBytes = candidates.reduce((sum, item) => sum + item.bytes, 0);

  let removedMedia = 0;
  let removedFiles = 0;
  let freedBytes = 0;
  let skipped = 0;
  const failures: string[] = [];

  if (!dryRun) {
    let referencedNow: Set<string> | null = null;
    for (const item of candidates) {
      if (item.type === 'media') {
        const mediaId = item.media_id;
        if (!mediaId) {
          skipped += 1;
          continue;
        }
        referencedNow ??= referencedMediaIds();
        if (referencedNow.has(mediaId)) {
          skipped += 1;
          continue;
        }
        try {
          freedBytes += await removeMedia(mediaId);
          removedMedia += 1;
          referencedNow.delete(mediaId);
        } catch (e) {
          failures.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        const dir = item.type === 'media_file' ? mediaDir : uploadsDir;
        try {
          await unlink(join(dir, item.name));
          freedBytes += item.bytes;
          removedFiles += 1;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') skipped += 1;
          else failures.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    db.prepare(
      `INSERT INTO storage_cleanups (cleanup_id, mode, media_removed, files_removed, bytes_freed, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      mode,
      removedMedia,
      removedFiles,
      freedBytes,
      JSON.stringify({ days, candidates: candidates.length, skipped, failures: failures.slice(0, 20) }),
      now,
    );
  }

  return {
    mode,
    dry_run: dryRun,
    retention_days: days,
    scanned_at: now,
    candidates: candidates.length,
    candidate_bytes: candidateBytes,
    items: candidates.slice(0, ITEM_CAP),
    removed_media: removedMedia,
    removed_files: removedFiles,
    freed_bytes: freedBytes,
    skipped,
    failures,
  };
}

let janitor: ReturnType<typeof setInterval> | null = null;

export function startStorageJanitor(): void {
  if (janitor) return;
  const { cleanupHours, retentionDays } = storageLimits();
  if (cleanupHours <= 0) {
    console.log('[storage] 周期清理已关闭（STORAGE_CLEANUP_HOURS=0）');
    return;
  }
  janitor = setInterval(() => {
    runCleanup({ mode: 'retention', olderThanDays: retentionDays, dryRun: false })
      .then((result) => {
        console.log(
          `[storage] 周期清理完成：媒体 ${result.removed_media} 个、文件 ${result.removed_files} 个，释放 ${result.freed_bytes} 字节`,
        );
      })
      .catch((e) => console.error('[storage] 周期清理失败:', e instanceof Error ? e.message : e));
  }, cleanupHours * 60 * 60 * 1000);
  janitor.unref?.();
  console.log(
    `[storage] 周期清理已启用：每 ${cleanupHours} 小时回收早于 ${retentionDays} 天的孤儿文件`,
  );
}
