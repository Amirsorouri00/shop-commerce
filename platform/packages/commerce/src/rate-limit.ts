import { logger } from '@xb/observability';

/**
 * Per-marketplace token bucket.
 *
 * This is the single most important thing standing between a working integration and a
 * blocked one. Marketplaces tolerate steady, modest traffic and react badly to bursts. A
 * queue of a thousand product resolutions dispatched as fast as the event loop allows is
 * indistinguishable from scraping, and the response is a block that no retry policy fixes.
 *
 * Token bucket rather than a fixed window because it permits a small burst — a user pasting
 * three links in a row should not wait — while holding the long-run rate at the configured
 * ceiling.
 *
 * `DistributedRateLimiter` is the same algorithm in Redis, so the ceiling is enforced across
 * every API and worker replica rather than per process. In-process limiting on four replicas
 * is a 4x limit, which defeats the purpose.
 */

export interface RateLimiter {
  /** Wait until a token is available, or throw if that would exceed `maxWaitMs`. */
  acquire(key: string, maxWaitMs?: number): Promise<void>;
  /** Take a token if one is free right now, without waiting. */
  tryAcquire(key: string): Promise<boolean>;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface BucketConfig {
  readonly ratePerSecond: number;
  readonly burst: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly configs: ReadonlyMap<string, BucketConfig>) {}

  private config(key: string): BucketConfig {
    return this.configs.get(key) ?? { ratePerSecond: 1, burst: 1 };
  }

  private refill(key: string): Bucket {
    const cfg = this.config(key);
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: cfg.burst, lastRefill: now };
      this.buckets.set(key, bucket);
      return bucket;
    }

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(cfg.burst, bucket.tokens + elapsedSec * cfg.ratePerSecond);
      bucket.lastRefill = now;
    }
    return bucket;
  }

  async tryAcquire(key: string): Promise<boolean> {
    const bucket = this.refill(key);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  async acquire(key: string, maxWaitMs = 10_000): Promise<void> {
    const cfg = this.config(key);
    const deadline = Date.now() + maxWaitMs;

    for (;;) {
      const bucket = this.refill(key);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }

      const needed = 1 - bucket.tokens;
      const waitMs = Math.ceil((needed / cfg.ratePerSecond) * 1000);

      if (Date.now() + waitMs > deadline) {
        throw new RateLimitExceededError(key, waitMs);
      }

      logger.debug({ key, waitMs }, 'rate limit: waiting for token');
      await sleep(Math.min(waitMs, 250));
    }
  }
}

export class RateLimitExceededError extends Error {
  constructor(
    readonly key: string,
    readonly waitMs: number,
  ) {
    super(`Rate limit for ${key} would require waiting ${waitMs}ms`);
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Redis-backed token bucket, evaluated atomically in Lua.
 *
 * Atomicity is the whole point: a read-modify-write from the client races between replicas
 * and lets the true rate drift above the ceiling exactly when traffic is heaviest.
 */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const BUCKET_SCRIPT = `
local key       = KEYS[1]
local rate      = tonumber(ARGV[1])
local burst     = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])

if tokens == nil then
  tokens = burst
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(burst, tokens + elapsed * rate)

local allowed = 0
local waitMs = 0

if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  waitMs = math.ceil(((requested - tokens) / rate) * 1000)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
-- Expire idle buckets so an abandoned key does not live forever.
redis.call('PEXPIRE', key, math.ceil((burst / rate) * 1000) + 60000)

return { allowed, waitMs }
`;

export class DistributedRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: RedisLike,
    private readonly configs: ReadonlyMap<string, BucketConfig>,
    private readonly prefix = 'ratelimit:',
  ) {}

  private config(key: string): BucketConfig {
    return this.configs.get(key) ?? { ratePerSecond: 1, burst: 1 };
  }

  private async evaluate(key: string): Promise<{ allowed: boolean; waitMs: number }> {
    const cfg = this.config(key);
    const result = (await this.redis.eval(
      BUCKET_SCRIPT,
      1,
      `${this.prefix}${key}`,
      cfg.ratePerSecond,
      cfg.burst,
      Date.now(),
      1,
    )) as [number, number];

    return { allowed: result[0] === 1, waitMs: result[1] };
  }

  async tryAcquire(key: string): Promise<boolean> {
    return (await this.evaluate(key)).allowed;
  }

  async acquire(key: string, maxWaitMs = 10_000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;

    for (;;) {
      const { allowed, waitMs } = await this.evaluate(key);
      if (allowed) return;

      if (Date.now() + waitMs > deadline) {
        throw new RateLimitExceededError(key, waitMs);
      }
      await sleep(Math.min(waitMs, 250));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

/** Build the limiter config from the marketplace descriptors, so limits live in one place. */
export function bucketConfigsFrom(
  marketplaces: readonly { id: string; rateLimitPerSecond: number; burst: number }[],
): Map<string, BucketConfig> {
  return new Map(
    marketplaces.map((m) => [m.id, { ratePerSecond: m.rateLimitPerSecond, burst: m.burst }]),
  );
}
