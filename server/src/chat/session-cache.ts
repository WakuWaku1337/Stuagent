export interface SessionCacheOptions {
  /** 最大条目数；<= 0 表示不限制 */
  max: number;
  /** 空闲过期时间（毫秒）；<= 0 表示不按时间过期 */
  ttlMs: number;
}

interface Entry<T> {
  value: T;
  lastUsed: number;
}

/** 带 LRU 与空闲 TTL 的轻量缓存，用于 Pi AgentSession。 */
export class SessionCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly options: SessionCacheOptions) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.expired(entry, now)) {
      this.entries.delete(key);
      return undefined;
    }
    // 命中后移到队尾，保证 Map 的插入顺序就是 LRU 顺序
    this.entries.delete(key);
    this.entries.set(key, { value: entry.value, lastUsed: now });
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, lastUsed: now });
    this.prune(now);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (predicate(key)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  prune(now = Date.now()): void {
    if (this.options.ttlMs > 0) {
      for (const [key, entry] of this.entries) {
        if (this.expired(entry, now)) this.entries.delete(key);
      }
    }
    if (this.options.max > 0) {
      while (this.entries.size > this.options.max) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
  }

  private expired(entry: Entry<T>, now: number): boolean {
    return this.options.ttlMs > 0 && now - entry.lastUsed > this.options.ttlMs;
  }
}