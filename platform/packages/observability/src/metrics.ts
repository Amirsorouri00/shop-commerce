/**
 * Metrics façade.
 *
 * Deliberately a thin interface over a no-op default rather than a hard dependency on the
 * OpenTelemetry SDK. Two reasons: packages stay importable in tests without booting a
 * telemetry pipeline, and the day the vendor changes, the change is one implementation of
 * this interface rather than an edit in every module that records a counter.
 *
 * `setMetrics()` installs the real OTel-backed implementation at process start.
 */

export type Labels = Readonly<Record<string, string | number | boolean>>;

export interface Metrics {
  counter(name: string, value?: number, labels?: Labels): void;
  histogram(name: string, value: number, labels?: Labels): void;
  gauge(name: string, value: number, labels?: Labels): void;
}

class NoopMetrics implements Metrics {
  counter(): void {}
  histogram(): void {}
  gauge(): void {}
}

let active: Metrics = new NoopMetrics();

export function setMetrics(impl: Metrics): void {
  active = impl;
}

export const metrics: Metrics = {
  counter: (n, v, l) => active.counter(n, v, l),
  histogram: (n, v, l) => active.histogram(n, v, l),
  gauge: (n, v, l) => active.gauge(n, v, l),
};

/** Time an operation and record duration plus outcome. Used by the instrumentation layer. */
export async function timed<T>(
  name: string,
  labels: Labels,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  let outcome = 'success';
  try {
    return await fn();
  } catch (e) {
    outcome = 'error';
    throw e;
  } finally {
    metrics.histogram(`${name}.duration_ms`, performance.now() - start, { ...labels, outcome });
    metrics.counter(`${name}.total`, 1, { ...labels, outcome });
  }
}

/** The metric names the dashboards are built on. Kept here so they cannot drift. */
export const METRIC = {
  httpRequest: 'http.server',
  portCall: 'port.call',
  cacheOp: 'cache.op',
  breakerState: 'resilience.breaker.state',
  queueConsume: 'amqp.consume',
  queuePublish: 'amqp.publish',
  outboxLag: 'outbox.lag_seconds',
  orderTransition: 'business.order.transition',
  quoteCreated: 'business.quote.created',
  exceptionRaised: 'business.exception.raised',
} as const;
