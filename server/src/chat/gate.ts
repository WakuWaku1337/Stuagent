import {
  AGENT_MAX_CONCURRENT,
  AGENT_MAX_CONCURRENT_PER_USER,
  AGENT_QUEUE_WAIT_MS,
} from '../config.ts';

export interface ChatGateOptions {
  /** 全局并发上限；<= 0 表示不限制 */
  max: number;
  /** 单用户并发上限；<= 0 表示不限制 */
  perUserMax: number;
  /** 全局满时最长排队时间；<= 0 表示不排队 */
  waitMs: number;
}

export class ChatBusyError extends Error {
  readonly code = 'CHAT_BUSY';

  constructor(message: string) {
    super(message);
    this.name = 'ChatBusyError';
  }
}

interface Waiter {
  learnerId: string;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 聊天并发门限：全局有上限，单用户有更小的上限。
 *
 * 只用于真正发起模型生成的聊天请求；工具内部的 chatJson 已被外层名额覆盖，
 * 后台 quiz/analysis 由单 worker 串行，不会放大并发。
 */
export class ChatGate {
  private active = 0;
  private readonly perUser = new Map<string, number>();
  private readonly waiters: Waiter[] = [];

  constructor(private readonly options: ChatGateOptions) {}

  /** 供 HTTP 层在写入用户消息前做快速拒绝；不是名额预留。 */
  wouldExceedPerUser(learnerId: string): boolean {
    return this.perUserFull(learnerId);
  }

  snapshot(): { active: number; waiting: number; perUser: Record<string, number> } {
    return {
      active: this.active,
      waiting: this.waiters.length,
      perUser: Object.fromEntries(this.perUser),
    };
  }

  acquire(learnerId: string): Promise<() => void> {
    if (this.perUserFull(learnerId)) {
      return Promise.reject(new ChatBusyError('你已有正在生成的回复，请等待完成后再发送'));
    }
    if (this.canAdmit(learnerId)) return Promise.resolve(this.admit(learnerId));
    if (this.options.waitMs <= 0) {
      return Promise.reject(new ChatBusyError('当前使用人数较多，请稍后再试'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new ChatBusyError('当前使用人数较多，请稍后再试'));
      }, this.options.waitMs);
      this.waiters.push({ learnerId, resolve, reject, timer });
    });
  }

  private canAdmit(learnerId: string): boolean {
    if (this.options.max > 0 && this.active >= this.options.max) return false;
    return !this.perUserFull(learnerId);
  }

  private perUserFull(learnerId: string): boolean {
    return (
      this.options.perUserMax > 0 &&
      (this.perUser.get(learnerId) ?? 0) >= this.options.perUserMax
    );
  }

  private admit(learnerId: string): () => void {
    this.active += 1;
    this.perUser.set(learnerId, (this.perUser.get(learnerId) ?? 0) + 1);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = (this.perUser.get(learnerId) ?? 1) - 1;
      if (next <= 0) this.perUser.delete(learnerId);
      else this.perUser.set(learnerId, next);
      this.drain();
    };
  }

  private drain(): void {
    for (let index = 0; index < this.waiters.length; ) {
      const waiter = this.waiters[index];
      if (!this.canAdmit(waiter.learnerId)) {
        index += 1;
        continue;
      }
      this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(this.admit(waiter.learnerId));
    }
  }
}

export const chatGate = new ChatGate({
  max: AGENT_MAX_CONCURRENT,
  perUserMax: AGENT_MAX_CONCURRENT_PER_USER,
  waitMs: AGENT_QUEUE_WAIT_MS,
});