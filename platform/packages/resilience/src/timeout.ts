import { TimeoutError } from '@xb/core';
import type { Layer } from './pipeline.ts';

/**
 * Bound a single call.
 *
 * Sits innermost among the resilience layers so each *attempt* gets its own deadline. Put it
 * outside retry instead and the deadline covers all attempts together, which means the last
 * retry is usually cancelled mid-flight — the worst of both behaviours.
 *
 * Note this races rather than cancels: without an AbortSignal the underlying request keeps
 * running. Adapters that accept a signal should take one; this is the backstop for those
 * that don't.
 */
export interface TimeoutOptions {
  readonly ms: number;
  /** Per-method overrides — a payment redirect may reasonably take longer than an FX quote. */
  readonly perMethod?: Readonly<Record<string, number>>;
}

export function timeout(options: TimeoutOptions): Layer {
  return async (inv, next) => {
    const ms = options.perMethod?.[inv.method] ?? options.ms;

    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TimeoutError(`${inv.port}.${inv.method}`, ms, {
          details: { provider: inv.provider },
        })),
        ms,
      );
      // Don't hold the process open for a pending timeout during shutdown.
      timer.unref?.();
    });

    try {
      return await Promise.race([next(), expiry]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
