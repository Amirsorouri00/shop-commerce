import type { Layer } from '@xb/resilience';
import { CacheAside } from './cache-aside.ts';
import type { CacheStore } from './store.ts';
import { createHash } from 'node:crypto';

/**
 * Cache-aside as a proxy layer.
 *
 * Sits *above* the circuit breaker in the chain: a cache hit must not be refused because the
 * origin is currently quarantined. Serving a cached FX rate while the provider is down is
 * the entire point of caching it.
 *
 * Methods not listed in `methods` pass straight through — a `charge()` call must never be
 * served from cache, and defaulting to "cache everything" makes that mistake easy to make.
 */

export interface CacheLayerMethodConfig {
  readonly ttlMs: number;
  readonly jitter?: number;
  readonly staleWhileRevalidateMs?: number;
  readonly negativeTtlMs?: number;
  /** Build the cache key from the call arguments. Defaults to a hash of the arguments. */
  readonly key?: (args: readonly unknown[]) => string;
  readonly isNegative?: (value: unknown) => boolean;
}

export interface CacheLayerOptions {
  readonly store: CacheStore;
  /** Only these methods are cached. Everything else passes through untouched. */
  readonly methods: Readonly<Record<string, CacheLayerMethodConfig>>;
}

export function cacheAside(options: CacheLayerOptions): Layer {
  const cache = new CacheAside(options.store);

  return async (inv, next) => {
    const config = options.methods[inv.method];
    if (!config) return next();

    const key = config.key
      ? config.key(inv.args)
      : `${inv.port}:${inv.method}:${hashArgs(inv.args)}`;

    return cache.get(
      {
        key,
        ttlMs: config.ttlMs,
        ...(config.jitter !== undefined ? { jitter: config.jitter } : {}),
        ...(config.staleWhileRevalidateMs !== undefined
          ? { staleWhileRevalidateMs: config.staleWhileRevalidateMs }
          : {}),
        ...(config.negativeTtlMs !== undefined ? { negativeTtlMs: config.negativeTtlMs } : {}),
        ...(config.isNegative ? { isNegative: config.isNegative } : {}),
      },
      next,
    );
  };
}

/** Stable short hash of the arguments — order-sensitive, which is what we want for a key. */
export function hashArgs(args: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('base64url').slice(0, 22);
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('base64url').slice(0, 22);
}
