import { uuidv7, type DomainEvent } from '@xb/core';
import { correlationId } from '@xb/observability';
import { outbox } from './schema.ts';
import type { Database } from './client.ts';

/**
 * Unit of work.
 *
 * The invariant this exists to enforce: a state change and the event announcing it are
 * written in **one transaction**. Publishing to RabbitMQ inside the transaction would be
 * worse, not better — the broker cannot participate in a Postgres transaction, so a commit
 * that fails after a successful publish announces something that never happened.
 *
 * So: the event goes to the outbox table transactionally, and a relay worker publishes it
 * afterwards. Delivery is at-least-once, which is why consumers dedupe on `processed_event`.
 */

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface UnitOfWorkContext {
  readonly tx: Tx;
  /** Queue a domain event. Written to the outbox as part of this same transaction. */
  emit(event: OutboxInput): void;
}

export interface OutboxInput {
  readonly topic: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly payload: Record<string, unknown>;
  readonly version?: number;
}

export class UnitOfWork {
  constructor(private readonly db: Database) {}

  /**
   * Run `fn` in a transaction; flush queued events to the outbox just before commit.
   *
   * Events are buffered rather than inserted immediately so that a handler which decides
   * partway through not to emit can simply not call `emit` — and so ordering reflects the
   * order the domain produced them.
   */
  async run<T>(fn: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const pending: OutboxInput[] = [];

      const ctx: UnitOfWorkContext = {
        tx,
        emit(event) {
          pending.push(event);
        },
      };

      const result = await fn(ctx);

      if (pending.length > 0) {
        const corr = correlationId();
        await tx.insert(outbox).values(
          pending.map((e) => ({
            id: uuidv7(),
            topic: e.topic,
            aggregateId: e.aggregateId,
            aggregateType: e.aggregateType,
            payload: e.payload,
            correlationId: corr,
            version: e.version ?? 1,
          })),
        );
      }

      return result;
    });
  }
}

/** Shape the relay publishes to RabbitMQ. */
export function toDomainEvent(row: {
  id: string;
  topic: string;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  correlationId: string;
  version: number;
  createdAt: Date;
}): DomainEvent {
  return {
    id: row.id,
    type: row.topic,
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    payload: row.payload,
    occurredAt: row.createdAt.toISOString(),
    correlationId: row.correlationId,
    version: row.version,
  };
}
