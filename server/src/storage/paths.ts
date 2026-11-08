import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const uploadsDir = process.env.EDU_UPLOADS_DIR?.trim()
  ? resolve(process.env.EDU_UPLOADS_DIR)
  : resolve(serverRoot, 'uploads');
export const mediaDir = resolve(uploadsDir, 'media');
