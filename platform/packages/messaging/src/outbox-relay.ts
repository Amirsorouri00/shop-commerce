import { logger, metrics, METRIC } from '@xb/observability';
import type { DomainEvent } from '@xb/core';
import type { Broker } from './broker.ts';

/**
 * The outbox relay.
 *
 * Drains rows written transactionally alongside domain state and publishes them. This is the
 * only publisher in the system — application code writes outbox rows and never touches the
 * broker — which is what makes "the state changed but the event never fired" impossible.
 *
 * The reverse failure (published but not marked) is possible and deliberately preferred:
 * it produces a duplicate delivery, which consumers already dedupe on, rather than a lost
 * event, which nothing can recover.
 */

export interface OutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly payload: unknown;
  readonly correlation_id: string;
  readonly version: number;
  readonly created_at: Date;
}

export interface OutboxSource {
  claimBatch(limit: number): Promise<Iterable<OutboxRow>>;
  markPublished(ids: readonly string[]): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  lagSeconds(): Promise<number>;
}

export interface RelayOptions {
  readonly batchSize?: number;
  readonly intervalMs?: number;
  /** Wraps one drain pass in a transaction so claimed rows stay locked while publishing. */
  readonly runInTransaction: <T>(fn: (source: OutboxSource) => Promise<T>) => Promise<T>;
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly broker: Broker,
    private readonly options: RelayOptions,
  ) {}

  start(): void {
    const interval = this.options.intervalMs ?? 500;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref?.();
    logger.info({ intervalMs: interval }, 'outbox relay started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    // Let an in-flight pass finish so a shutdown does not strand claimed rows.
    while (this.running) await sleep(50);
    logger.info('outbox relay stopped');
  }

  /** One drain pass. Overlapping passes are skipped rather than queued. */
  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;

    try {
      await this.options.runInTransaction(async (source) => {
        const rows = [...(await source.claimBatch(this.options.batchSize ?? 100))];
        if (rows.length === 0) return;

        const published: string[] = [];

        for (const row of rows) {
          const event: DomainEvent = {
            id: row.id,
            type: row.topic,
            aggregateId: row.aggregate_id,
            aggregateType: row.aggregate_type,
            payload: row.payload,
            occurredAt: new Date(row.created_at).toISOString(),
            correlationId: row.correlation_id,
            version: row.version,
          };

          try {
            await this.broker.publish(event);
            published.push(row.id);
          } catch (e) {
            // Leave the row unpublished — the next pass retries it. Ordering within an
            // aggregate is preserved because the batch is drained oldest-first.
            await source.markFailed(row.id, e instanceof Error ? e.message : String(e));
            logger.error({ outboxId: row.id, topic: row.topic, err: e }, 'outbox publish failed');
            break;
          }
        }

        if (published.length > 0) {
          await source.markPublished(published);
          logger.debug({ count: published.length }, 'outbox batch published');
        }

        metrics.gauge(METRIC.outboxLag, await source.lagSeconds());
      });
    } catch (e) {
      logger.error({ err: e }, 'outbox relay pass failed');
    } finally {
      this.running = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}
