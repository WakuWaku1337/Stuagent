import './lib/same-origin-fetch.ts';
import { access, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addMessage, createConversation } from '../src/conversations/service.ts';
import { getMedia, mediaDir, toAttachment } from '../src/media/service.ts';
import { uploadDir } from '../src/documents/service.ts';
import { checkStorageQuota, quotaSummary } from '../src/storage/quota.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const statsRes = await fetch(`${BASE}/api/media/storage`);
  const stats = await statsRes.json();
  report(
    statsRes.status === 200 &&
      typeof stats.quota?.limit_mb === 'number' &&
      typeof stats.media?.count === 'number' &&
      typeof stats.documents?.count === 'number' &&
      typeof stats.disk?.files === 'number' &&
      Array.isArray(stats.cleanup?.history),
    'storage stats',
    `quota ${stats.quota?.limit_mb}MB, media ${stats.media?.count}, disk ${stats.disk?.files} files`,
  );

  const png = await readFile('testdata/vision-question.png');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'vision-question.png');
  const upload = await fetch(`${BASE}/api/media/upload`, { method: 'POST', body: form });
  const uploaded = await upload.json();
  const mediaId: string = uploaded.media_id ?? '';
  const row = mediaId ? getMedia(mediaId) : undefined;
  report(upload.status === 201 && Boolean(row), 'media uploaded for cascade', mediaId || 'no id');

  if (row) {
    const conversation = createConversation('S22 级联测试');
    addMessage(conversation.conversation_id, {
      role: 'user',
      content: 'S22 级联删除测试',
      msgType: 'image',
      attachments: [toAttachment(row)],
    });
    const referencedStats = await fetch(`${BASE}/api/media/storage`).then((res) => res.json());
    report(referencedStats.media.referenced >= 1, 'media referenced by seeded message');

    const mediaPath = join(mediaDir, row.stored_name);
    const deleted = await fetch(`${BASE}/api/conversations/${conversation.conversation_id}`, {
      method: 'DELETE',
    }).then((res) => res.json());
    const rowGone = getMedia(mediaId) === undefined;
    const fileGone = !(await exists(mediaPath));
    report(
      deleted.media_removed >= 1 && rowGone && fileGone,
      'conversation delete releases media',
      `removed ${deleted.media_removed}, ${deleted.bytes_freed} bytes`,
    );
  }

  const docText = `S22 document cascade ${Date.now()}`;
  const docForm = new FormData();
  docForm.append('file', new Blob([docText], { type: 'text/plain' }), `s22-${Date.now()}.txt`);
  const docRes = await fetch(`${BASE}/api/documents`, { method: 'POST', body: docForm });
  const doc = await docRes.json();
  const docPath = doc.document_id ? join(uploadDir, `${doc.document_id}.txt`) : '';
  const docExisted = docPath ? await exists(docPath) : false;
  if (doc.document_id) {
    await fetch(`${BASE}/api/documents/${doc.document_id}`, { method: 'DELETE' });
  }
  const docGone = docPath ? !(await exists(docPath)) : false;
  report(docRes.status === 200 && docExisted && docGone, 'document delete removes upload file');

  const orphanName = `s22-retention-${Date.now()}.bin`;
  const orphanPath = join(uploadDir, orphanName);
  await writeFile(orphanPath, Buffer.alloc(2048, 1));
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await utimes(orphanPath, old, old);
  const preview = await postJson('/api/media/cleanup', {
    mode: 'retention',
    olderThanDays: 1,
    dryRun: true,
  });
  const flagged = preview.body.items?.some((item: { name: string }) => item.name === orphanName);
  const previewKept = await exists(orphanPath);
  report(
    preview.status === 200 && preview.body.dry_run === true && flagged && previewKept,
    'retention dry run flags old orphan',
    `${preview.body.candidates} candidates`,
  );
  const retention = await postJson('/api/media/cleanup', {
    mode: 'retention',
    olderThanDays: 1,
    dryRun: false,
  });
  const retentionRemoved = !(await exists(orphanPath));
  report(
    retention.status === 200 && retention.body.removed_files >= 1 && retentionRemoved,
    'retention cleanup removes old orphan',
    `${retention.body.freed_bytes} bytes freed`,
  );

  const originalQuota = process.env.STORAGE_QUOTA_MB;
  process.env.STORAGE_QUOTA_MB = '1';
  const lowQuota = quotaSummary();
  const blocked = checkStorageQuota(2 * 1024 * 1024);
  process.env.STORAGE_QUOTA_MB = '0';
  const unlimited = quotaSummary();
  const allowed = checkStorageQuota(2 * 1024 * 1024);
  if (originalQuota === undefined) delete process.env.STORAGE_QUOTA_MB;
  else process.env.STORAGE_QUOTA_MB = originalQuota;
  report(
    lowQuota.status === 'exceeded' && lowQuota.limit_mb === 1 && !blocked.allowed && unlimited.status === 'unlimited' && allowed.allowed,
    'quota guard and unlimited mode',
    blocked.message,
  );

  const finalStats = await fetch(`${BASE}/api/media/storage`).then((res) => res.json());
  report(
    finalStats.cleanup.history.length >= 1 && finalStats.orphans.total_count === 0,
    'cleanup history recorded and orphans cleared',
    `${finalStats.cleanup.history.length} record(s)`,
  );

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
