import { isAppError } from '@xb/core';
import { logger, metrics, METRIC } from '@xb/observability';
import type { Layer } from './pipeline.ts';

/**
 * Telemetry for every port call.
 *
 * Outermost layer, so the duration recorded is what the *caller* actually waited — including
 * cache lookups, backoff sleeps and breaker checks. Measuring only the network call would
 * report a healthy p95 while users experience a slow one.
 */
export interface InstrumentOptions {
  /** Log arguments at debug level. Off by default — arguments routinely contain PII. */
  readonly logArgs?: boolean;
  /** Calls slower than this are logged at warn even when they succeed. */
  readonly slowCallMs?: number;
}

export function instrument(options: InstrumentOptions = {}): Layer {
  const slowMs = options.slowCallMs ?? 3_000;

  return async (inv, next) => {
    const start = performance.now();
    const labels = { port: inv.port, provider: inv.provider, method: inv.method };

    try {
      const result = await next();
      const duration = performance.now() - start;

      metrics.histogram(`${METRIC.portCall}.duration_ms`, duration, {
        ...labels,
        outcome: 'success',
      });
      metrics.counter(`${METRIC.portCall}.total`, 1, { ...labels, outcome: 'success' });

      if (duration > slowMs) {
        logger.warn({ ...labels, durationMs: Math.round(duration) }, 'slow port call');
      } else {
        logger.debug(
          {
            ...labels,
            durationMs: Math.round(duration),
            ...(options.logArgs ? { args: inv.args } : {}),
          },
          'port call',
        );
      }

      return result;
    } catch (e) {
      const duration = performance.now() - start;
      const errorCode = isAppError(e) ? e.code : 'UNKNOWN';

      metrics.histogram(`${METRIC.portCall}.duration_ms`, duration, {
        ...labels,
        outcome: 'error',
      });
      metrics.counter(`${METRIC.portCall}.total`, 1, { ...labels, outcome: 'error', errorCode });

      logger.warn(
        { ...labels, durationMs: Math.round(duration), errorCode, err: e },
        'port call failed',
      );

      throw e;
    }
  };
}
