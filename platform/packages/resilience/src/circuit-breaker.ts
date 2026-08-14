import { CircuitOpenError, isAppError } from '@xb/core';
import { logger, metrics, METRIC } from '@xb/observability';
import type { Layer } from './pipeline.ts';

/**
 * Circuit breaker.
 *
 * When a provider is already known to be down, the useful thing is to fail immediately.
 * Continuing to send it traffic ties up connections, delays every caller by the full
 * timeout, and slows the provider's own recovery.
 *
 * States:
 *   CLOSED    — normal. Failures are counted in a rolling window.
 *   OPEN      — fail fast without calling. After `resetMs`, move to HALF_OPEN.
 *   HALF_OPEN — let a limited number of probes through. Enough successes close it;
 *               a single failure opens it again with a fresh timer.
 *
 * The rolling window matters: a naive consecutive-failure counter is reset by a single
 * lucky success, so a provider failing 90% of calls never trips the breaker.
 *
 * Only *infrastructure* failures count. A provider correctly rejecting an invalid request
 * is working fine, and counting 4xx toward the breaker would quarantine a healthy provider
 * because our own callers sent bad input.
 */

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Failures within the window needed to open. */
  readonly threshold: number;
  /** Rolling window for counting failures. */
  readonly windowMs?: number;
  /** How long to stay open before probing. */
  readonly resetMs: number;
  /** Successful probes required to close from HALF_OPEN. */
  readonly successesToClose?: number;
  /** Minimum calls in the window before the breaker may trip, so 1-of-1 doesn't open it. */
  readonly minimumThroughput?: number;
}

export interface BreakerSnapshot {
  readonly provider: string;
  readonly state: BreakerState;
  readonly failures: number;
  readonly openedAt: number | undefined;
  readonly lastError: string | undefined;
}

/** Per-provider breaker state, readable by the failover selector and the admin endpoint. */
export class BreakerRegistry {
  private readonly breakers = new Map<string, Breaker>();

  get(key: string, options: CircuitBreakerOptions): Breaker {
    let b = this.breakers.get(key);
    if (!b) {
      b = new Breaker(key, options);
      this.breakers.set(key, b);
    }
    return b;
  }

  snapshot(): BreakerSnapshot[] {
    return [...this.breakers.values()].map((b) => b.snapshot());
  }

  /** True when the provider is fail-fast. The failover selector skips these. */
  isQuarantined(key: string): boolean {
    return this.breakers.get(key)?.currentState === 'OPEN';
  }

  reset(): void {
    this.breakers.clear();
  }
}

export const breakerRegistry = new BreakerRegistry();

export class Breaker {
  private state: BreakerState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private callsInWindow: number[] = [];
  private halfOpenSuccesses = 0;
  private openedAt: number | undefined;
  private lastError: string | undefined;

  private readonly windowMs: number;
  private readonly successesToClose: number;
  private readonly minimumThroughput: number;

  constructor(
    readonly key: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.windowMs = options.windowMs ?? 60_000;
    this.successesToClose = options.successesToClose ?? 2;
    this.minimumThroughput = options.minimumThroughput ?? 5;
  }

  get currentState(): BreakerState {
    this.maybeHalfOpen();
    return this.state;
  }

  private maybeHalfOpen(): void {
    if (
      this.state === 'OPEN' &&
      this.openedAt !== undefined &&
      Date.now() - this.openedAt >= this.options.resetMs
    ) {
      this.state = 'HALF_OPEN';
      this.halfOpenSuccesses = 0;
      logger.info({ provider: this.key }, 'circuit half-open, probing');
      metrics.gauge(METRIC.breakerState, 1, { provider: this.key, state: 'HALF_OPEN' });
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t > cutoff);
    this.callsInWindow = this.callsInWindow.filter((t) => t > cutoff);
  }

  recordSuccess(): void {
    const now = Date.now();
    this.prune(now);
    this.callsInWindow.push(now);

    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.successesToClose) this.close();
    }
  }

  recordFailure(error: unknown): void {
    const now = Date.now();
    this.prune(now);
    this.callsInWindow.push(now);
    this.failureTimestamps.push(now);
    this.lastError = error instanceof Error ? error.message : String(error);

    // A failed probe re-opens immediately — the provider is clearly not well yet.
    if (this.state === 'HALF_OPEN') {
      this.open();
      return;
    }

    if (
      this.state === 'CLOSED' &&
      this.callsInWindow.length >= this.minimumThroughput &&
      this.failureTimestamps.length >= this.options.threshold
    ) {
      this.open();
    }
  }

  private open(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
    logger.warn(
      { provider: this.key, failures: this.failureTimestamps.length, lastError: this.lastError },
      'circuit opened',
    );
    metrics.gauge(METRIC.breakerState, 2, { provider: this.key, state: 'OPEN' });
  }

  private close(): void {
    this.state = 'CLOSED';
    this.openedAt = undefined;
    this.failureTimestamps = [];
    this.halfOpenSuccesses = 0;
    logger.info({ provider: this.key }, 'circuit closed');
    metrics.gauge(METRIC.breakerState, 0, { provider: this.key, state: 'CLOSED' });
  }

  snapshot(): BreakerSnapshot {
    return {
      provider: this.key,
      state: this.currentState,
      failures: this.failureTimestamps.length,
      openedAt: this.openedAt,
      lastError: this.lastError,
    };
  }
}

/**
 * Only count failures that indicate the provider is unhealthy.
 * A 4xx means our request was wrong; the provider answered correctly and quickly.
 */
function countsAsProviderFailure(e: unknown): boolean {
  if (!isAppError(e)) return true; // unknown failures are assumed to be infrastructure
  return e.httpStatus >= 500 || e.code === 'TIMEOUT';
}

export function circuitBreaker(
  options: CircuitBreakerOptions,
  registry: BreakerRegistry = breakerRegistry,
): Layer {
  return async (inv, next) => {
    const key = `${inv.port}:${inv.provider}`;
    const breaker = registry.get(key, options);

    if (breaker.currentState === 'OPEN') {
      throw new CircuitOpenError(inv.provider, {
        details: { port: inv.port, method: inv.method },
      });
    }

    try {
      const result = await next();
      breaker.recordSuccess();
      return result;
    } catch (e) {
      if (countsAsProviderFailure(e)) breaker.recordFailure(e);
      else breaker.recordSuccess(); // provider behaved; our request didn't
      throw e;
    }
  };
}
