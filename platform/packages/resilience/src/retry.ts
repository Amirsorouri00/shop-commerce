import { isRetryable, isAppError } from '@xb/core';
import { logger } from '@xb/observability';
import type { Layer, Invocation } from './pipeline.ts';

/**
 * Retry with exponential backoff and full jitter.
 *
 * Two things make this safe rather than harmful:
 *
 *   - **Only retryable errors are retried.** A 422 will fail identically every time; retrying
 *     it wastes a provider's rate limit and delays the user's error message. Retryability is
 *     declared on the error class, not guessed from a message.
 *
 *   - **Full jitter, not fixed backoff.** If a provider blips and a hundred in-flight calls
 *     all back off by exactly 100ms, they retry in the same millisecond and blip it again.
 *     Randomising across the whole window spreads them out. (AWS's "Exponential Backoff and
 *     Jitter"; full jitter measurably beats equal jitter for contention.)
 *
 * Non-idempotent methods must be listed in `nonRetryableMethods`. Retrying a purchase is how
 * a customer gets charged twice.
 */
export interface RetryOptions {
  readonly attempts: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Methods that must never be retried regardless of the error. */
  readonly nonRetryableMethods?: readonly string[];
  /** Override the default "is this worth retrying" decision. */
  readonly isRetryable?: (error: unknown, inv: Invocation) => boolean;
}

export function retry(options: RetryOptions): Layer {
  const base = options.baseDelayMs ?? 100;
  const max = options.maxDelayMs ?? 5_000;
  const never = new Set(options.nonRetryableMethods ?? []);
  const shouldRetry = options.isRetryable ?? ((e: unknown) => isRetryable(e));

  return async (inv, next) => {
    if (never.has(inv.method)) return next();

    let lastError: unknown;

    for (let attempt = 1; attempt <= options.attempts; attempt++) {
      try {
        return await next();
      } catch (e) {
        lastError = e;

        if (attempt === options.attempts || !shouldRetry(e, inv)) throw e;

        // Full jitter: sleep a random duration in [0, min(max, base * 2^(n-1))].
        const ceiling = Math.min(max, base * 2 ** (attempt - 1));
        const delay = Math.random() * ceiling;

        logger.debug(
          {
            port: inv.port,
            provider: inv.provider,
            method: inv.method,
            attempt,
            of: options.attempts,
            delayMs: Math.round(delay),
            errorCode: isAppError(e) ? e.code : undefined,
          },
          'retrying after failure',
        );

        await sleep(delay);
      }
    }

    throw lastError;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}
