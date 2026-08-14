import type { Redis } from 'ioredis';

/**
 * The cache store interface.
 *
 * Abstracted so tests run without Redis and so an L1 in-process tier can be slotted in
 * front of L2 later without touching a single caller.
 */

export interface CacheEntry<T> {
  readonly value: T;
  /** Epoch ms when the value became stale. Past this, it may still be served while revalidating. */
  readonly freshUntil: number;
  /** Epoch ms after which the value must not be served at all. */
  readonly serveUntil: number;
  /** Marks a cached "not found", so a miss isn't re-fetched on every retry. */
  readonly negative: boolean;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, entry: CacheEntry<T>, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Delete every key matching a prefix. Used for write-through invalidation. */
  delByPrefix(prefix: string): Promise<number>;
  /** Single-flight lock. Returns a release function, or undefined if another caller holds it. */
  acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | undefined>;
}

// ─────────────────────────── Redis ───────────────────────────

export class RedisCacheStore implements CacheStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'cache:',
  ) {}

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    const raw = await this.redis.get(this.k(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      // A corrupt entry is a cache miss, not an outage. Drop it and move on.
      await this.del(key);
      return undefined;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>, ttlMs: number): Promise<void> {
    await this.redis.set(this.k(key), JSON.stringify(entry), 'PX', Math.max(1, Math.ceil(ttlMs)));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  /**
   * Uses SCAN, never KEYS. KEYS blocks the single-threaded Redis event loop for the whole
   * scan, which on a production keyspace is a multi-second stall for every other caller.
   */
  async delByPrefix(prefix: string): Promise<number> {
    const match = `${this.k(prefix)}*`;
    let cursor = '0';
    let deleted = 0;

    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }

  /**
   * Lock via SET NX PX with a random token, released by a Lua compare-and-delete.
   *
   * The token matters: a plain DEL would let a caller whose lock already expired delete the
   * lock a *different* caller now holds, which reintroduces the stampede the lock prevents.
   */
  async acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | undefined> {
    const lockKey = `${this.prefix}lock:${key}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const acquired = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return undefined;

    return async () => {
      await this.redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        lockKey,
        token,
      );
    };
  }
}

// ─────────────────────────── in-memory ───────────────────────────

/** For tests and for an L1 tier. Bounded, with LRU eviction. */
export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, { entry: CacheEntry<unknown>; expiresAt: number }>();
  private readonly locks = new Map<string, number>();

  constructor(private readonly maxEntries = 5_000) {}

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency for LRU.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.entry as CacheEntry<T>;
  }

  async set<T>(key: string, entry: CacheEntry<T>, ttlMs: number): Promise<void> {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { entry, expiresAt: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }

  async acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | undefined> {
    const now = Date.now();
    const held = this.locks.get(key);
    if (held !== undefined && held > now) return undefined;
    this.locks.set(key, now + ttlMs);
    return async () => {
      this.locks.delete(key);
    };
  }

  clear(): void {
    this.map.clear();
    this.locks.clear();
  }
}
