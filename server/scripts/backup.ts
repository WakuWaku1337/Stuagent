import { existsSync } from 'node:fs';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { db, dbPath } = await import('../src/store.ts');
const { uploadsDir } = await import('../src/storage/paths.ts');

const withUploads = process.argv.includes('--with-uploads');
const backupDir = join(dirname(dbPath()), 'backups');
await mkdir(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = join(backupDir, `edu-${stamp}.db`);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

if (withUploads) {
  const uploadsTarget = join(backupDir, `uploads-${stamp}`);
  await cp(uploadsDir, uploadsTarget, { recursive: true });
  console.log(`uploads 已备份到 ${uploadsTarget}`);
}

if (existsSync(envPath)) {
  await copyFile(envPath, join(backupDir, `.env-${stamp}`));
}

console.log(`SQLite 备份完成：${target}`);
