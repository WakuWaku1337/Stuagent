import { db } from './store.ts';
import { IDEMPOTENCY_RETENTION_HOURS, MAINTENANCE_INTERVAL_HOURS, TASK_RETENTION_DAYS } from './config.ts';

export interface MaintenanceResult {
  idempotency: number;
  answerCache: number;
  tasks: number;
}

function answerCacheRetentionMinutes(): number {
  const ttl = Number(process.env.ANSWER_CACHE_TTL_MIN ?? 60);
  if (!Number.isFinite(ttl)) return 60;
  // 缓存关闭时仍保留 7 天，避免把刚写入但尚未被读取的记录立即删掉
  return ttl > 0 ? ttl : 7 * 24 * 60;
}

/** 清理只增不减的运行时表；只删除过期数据，不碰业务主数据。 */
export function runMaintenance(now = Date.now()): MaintenanceResult {
  const idempotencyCutoff = now - IDEMPOTENCY_RETENTION_HOURS * 3_600_000;
  const idempotency = Number(
    db.prepare('DELETE FROM chat_idempotency WHERE created_at < ?').run(idempotencyCutoff).changes,
  );

  const answerCutoff = now - answerCacheRetentionMinutes() * 60_000;
  const answerCache = Number(
    db.prepare('DELETE FROM answer_cache WHERE created_at < ?').run(answerCutoff).changes,
  );

  const taskCutoff = now - TASK_RETENTION_DAYS * 86_400_000;
  const tasks = Number(
    db
      .prepare(
        `DELETE FROM tasks
         WHERE status IN ('done', 'failed', 'timeout', 'cancelled')
           AND COALESCE(finished_at, created_at) < ?`,
      )
      .run(taskCutoff).changes,
  );

  return { idempotency, answerCache, tasks };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startMaintenance(): void {
  if (timer) return;
  if (MAINTENANCE_INTERVAL_HOURS <= 0) {
    console.log('[maintenance] 周期清理已关闭（MAINTENANCE_INTERVAL_HOURS=0）');
    return;
  }

  const run = () => {
    try {
      const result = runMaintenance();
      if (result.idempotency || result.answerCache || result.tasks) {
        console.log(
          `[maintenance] 清理完成：幂等 ${result.idempotency} 条、答案缓存 ${result.answerCache} 条、任务 ${result.tasks} 条`,
        );
      }
    } catch (error) {
      console.error('[maintenance] 清理失败:', error instanceof Error ? error.message : error);
    }
  };

  // 启动后先等一分钟，避开启动高峰
  const first = setTimeout(run, 60_000);
  first.unref?.();
  timer = setInterval(run, MAINTENANCE_INTERVAL_HOURS * 3_600_000);
  timer.unref?.();
  console.log(`[maintenance] 周期清理已启用：每 ${MAINTENANCE_INTERVAL_HOURS} 小时`);
}