/** 上传限制的唯一来源：后端校验与文档均以此为准，前端常量需保持同步。 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BATCH_FILES = 50;
export const MAX_BATCH_BYTES = 200 * 1024 * 1024;

export const UPLOAD_LIMITS = {
  maxFileMb: MAX_FILE_BYTES / 1024 / 1024,
  maxBatchFiles: MAX_BATCH_FILES,
  maxBatchMb: MAX_BATCH_BYTES / 1024 / 1024,
} as const;
