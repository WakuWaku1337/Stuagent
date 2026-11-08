import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../store.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const dataRoot = process.env.EDU_DATA_DIR?.trim()
  ? resolve(process.env.EDU_DATA_DIR)
  : resolve(serverRoot, 'data');
const coursewareDir = join(dataRoot, 'courseware');

export interface LegacyCourseware {
  courseware_id: string;
  title: string;
  topic: string;
  subject: string | null;
  source: string;
  created_at: number;
}

export function listLegacyCourseware(): LegacyCourseware[] {
  return db
    .prepare('SELECT courseware_id, title, topic, subject, source, created_at FROM courseware ORDER BY created_at DESC')
    .all() as unknown as LegacyCourseware[];
}

export function getLegacyCourseware(id: string): (LegacyCourseware & { html: string }) | undefined {
  return db.prepare('SELECT * FROM courseware WHERE courseware_id = ?').get(id) as unknown as
    | (LegacyCourseware & { html: string })
    | undefined;
}

export function deleteLegacyCourseware(id: string): boolean {
  const changes = db.prepare('DELETE FROM courseware WHERE courseware_id = ?').run(id).changes;
  void unlink(join(coursewareDir, `${id}.html`)).catch(() => undefined);
  return changes > 0;
}