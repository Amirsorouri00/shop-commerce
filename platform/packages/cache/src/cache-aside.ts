import { logger, metrics, METRIC } from '@xb/observability';
import type { CacheStore, CacheEntry } from './store.ts';

/**
 * Cache-aside with the four refinements that separate a cache that helps from one that
 * causes the outage it was meant to prevent.
 *
 *   1. **Single-flight.** On a miss, exactly one caller loads from origin; the rest wait for
 *      it. Without this a cold key under load becomes N simultaneous origin calls — the
 *      stampede that takes down the provider you were trying to protect.
 *
 *   2. **TTL jitter.** Keys written together would otherwise expire together. After a deploy
 *      warms the cache, every key expiring in the same second recreates the stampede on a
 *      timer. Spreading expiry across a window prevents synchronised misses.
 *
 *   3. **Negative caching.** An unresolvable product URL is re-fetched on every impatient
 *      retry unless the "not found" is itself cached — with a short TTL, since the answer
 *      may change.
 *
 *   4. **Stale-while-revalidate.** Past freshness but within the serve window, return the
 *      stale value immediately and refresh in the background. Latency stays flat at expiry,
 *      and a brief origin outage is invisible.
 */

export interface CacheAsideOptions<T> {
  readonly key: string;
  /** How long the value is considered fresh. */
  readonly ttlMs: number;
  /** Fraction of ttlMs to randomise by, 0..1. Default 0.15. */
  readonly jitter?: number;
  /** Extra window past freshness during which a stale value may still be served. */
  readonly staleWhileRevalidateMs?: number;
  /** TTL for a cached "not found". Short, because absence is usually temporary. */
  readonly negativeTtlMs?: number;
  /** How long to wait for the single-flight holder before loading anyway. */
  readonly lockTimeoutMs?: number;
  /** Treat this result as a negative (cacheable "nothing here"). */
  readonly isNegative?: (value: T) => boolean;
}

export class CacheAside {
  constructor(private readonly store: CacheStore) {}

  async get<T>(options: CacheAsideOptions<T>, load: () => Promise<T>): Promise<T> {
    const {
      key,
      ttlMs,
      jitter = 0.15,
      staleWhileRevalidateMs = 0,
      negativeTtlMs = 30_000,
      lockTimeoutMs = 5_000,
      isNegative,
    } = options;

    const now = Date.now();
    const cached = await this.store.get<T>(key);

    if (cached) {
      if (now < cached.freshUntil) {
        metrics.counter(METRIC.cacheOp, 1, { op: 'get', outcome: 'hit' });
        return cached.value;
      }

      if (now < cached.serveUntil) {
        // Stale but servable. Return now; refresh behind the request.
        metrics.counter(METRIC.cacheOp, 1, { op: 'get', outcome: 'stale' });
        void this.refreshInBackground(options, load);
        return cached.value;
      }
    }

    metrics.counter(METRIC.cacheOp, 1, { op: 'get', outcome: 'miss' });

    // Single-flight: one loader, everyone else waits and re-reads.
    const release = await this.store.acquireLock(key, lockTimeoutMs);

    if (!release) {
      const waited = await this.waitForHolder<T>(key, lockTimeoutMs);
      if (waited !== undefined) return waited;
      // Holder never published — fall through and load ourselves rather than fail.
      logger.debug({ key }, 'single-flight holder produced nothing; loading directly');
      return load();
    }

    try {
      const value = await load();
      const negative = isNegative?.(value) ?? false;
      await this.write(key, value, negative ? negativeTtlMs : ttlMs, jitter, staleWhileRevalidateMs, negative);
      return value;
    } catch (e) {
      // Origin failed. A stale copy beats an error for anything not price-critical;
      // callers that must not serve stale pass staleWhileRevalidateMs: 0.
      if (cached && staleWhileRevalidateMs > 0) {
        logger.warn({ key, err: e }, 'origin failed; serving stale value');
        metrics.counter(METRIC.cacheOp, 1, { op: 'get', outcome: 'stale_on_error' });
        return cached.value;
      }
      throw e;
    } finally {
      await release();
    }
  }

  private async write<T>(
    key: string,
    value: T,
    ttlMs: number,
    jitter: number,
    swrMs: number,
    negative: boolean,
  ): Promise<void> {
    // Jitter is symmetric around the nominal TTL so the mean is unchanged.
    const spread = ttlMs * jitter;
    const effective = Math.max(1, ttlMs + (Math.random() * 2 - 1) * spread);
    const now = Date.now();

    const entry: CacheEntry<T> = {
      value,
      freshUntil: now + effective,
      serveUntil: now + effective + swrMs,
      negative,
    };

    await this.store.set(key, entry, effective + swrMs);
    metrics.counter(METRIC.cacheOp, 1, { op: 'set', negative: String(negative) });
  }

  /** Poll briefly for the single-flight holder's result. */
  private async waitForHolder<T>(key: string, timeoutMs: number): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    const step = 25;

    while (Date.now() < deadline) {
      await sleep(step);
      const entry = await this.store.get<T>(key);
      if (entry && Date.now() < entry.serveUntil) {
        metrics.counter(METRIC.cacheOp, 1, { op: 'get', outcome: 'hit_after_wait' });
        return entry.value;
      }
    }
    return undefined;
  }

  private async refreshInBackground<T>(
    options: CacheAsideOptions<T>,
    load: () => Promise<T>,
  ): Promise<void> {
    // Only one background refresh per key; if the lock is held, someone is already on it.
    const release = await this.store.acquireLock(`swr:${options.key}`, 10_000);
    if (!release) return;

    try {
      const value = await load();
      const negative = options.isNegative?.(value) ?? false;
      await this.write(
        options.key,
        value,
        negative ? (options.negativeTtlMs ?? 30_000) : options.ttlMs,
        options.jitter ?? 0.15,
        options.staleWhileRevalidateMs ?? 0,
        negative,
      );
    } catch (e) {
      // Background refresh failure is not the caller's problem — they already have a value.
      logger.debug({ key: options.key, err: e }, 'background revalidation failed');
    } finally {
      await release();
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.store.del(key);
    metrics.counter(METRIC.cacheOp, 1, { op: 'invalidate' });
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    const n = await this.store.delByPrefix(prefix);
    metrics.counter(METRIC.cacheOp, n, { op: 'invalidate_prefix' });
    return n;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

/** Cache key builders, centralised so invalidation and reads cannot disagree. */
export const CacheKeys = {
  fx: (from: string, to: string) => `fx:${from}_${to}`,
  resolve: (urlHash: string) => `resolve:${urlHash}`,
  customs: (route: string, category: string) => `customs:${route}:${category}`,
  orderView: (orderId: string) => `order:${orderId}:view`,
  exceptionQueue: () => `exceptions:ranked`,
  session: (jti: string) => `session:${jti}`,
  idempotency: (key: string) => `idem:${key}`,
} as const;
