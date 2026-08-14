import type { Channel } from 'amqplib';
import { logger } from '@xb/observability';

/**
 * RabbitMQ topology.
 *
 * One topic exchange for domain events, plus a retry path built from a delayed queue rather
 * than an in-process sleep. That distinction matters: an in-process `setTimeout` retry is
 * lost on deploy, and a queue of sleeping consumers is a queue that is not consuming.
 *
 * The retry mechanism uses RabbitMQ's dead-letter behaviour in reverse:
 *
 *   1. A consumer nacks a message.
 *   2. The queue's dead-letter exchange routes it to a delay queue with a per-message TTL.
 *   3. The delay queue has no consumer; its own dead-letter exchange is the main exchange.
 *   4. When the TTL expires, the message is republished to the main exchange and redelivered.
 *
 * Attempts are counted in a header. Past the limit, the message is parked for a human rather
 * than cycled forever.
 */

export const EXCHANGES = {
  events: 'xb.events',
  retry: 'xb.retry',
  dead: 'xb.dlx',
} as const;

export const QUEUES = {
  procurement: 'q.procurement',
  tracking: 'q.tracking',
  notification: 'q.notify',
  reconciliation: 'q.recon',
  fx: 'q.fx',
  parked: 'q.parked',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Which routing keys each consumer binds. `order.*` picks up events added later, too. */
export const BINDINGS: Readonly<Record<QueueName, readonly string[]>> = {
  [QUEUES.procurement]: ['order.paid', 'procurement.*'],
  [QUEUES.tracking]: ['procurement.purchased', 'shipment.*'],
  [QUEUES.notification]: ['order.*', 'payment.*', 'exception.*'],
  [QUEUES.reconciliation]: ['payment.settled', 'payment.failed', 'ledger.posted'],
  [QUEUES.fx]: ['fx.*'],
  [QUEUES.parked]: [],
};

/** Backoff schedule. Beyond the last entry the message is parked. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 300_000] as const;

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

const delayQueueName = (ms: number): string => `q.retry.${ms}`;

/**
 * Declare everything, idempotently.
 *
 * Safe to run on every boot of every replica — AMQP declarations are idempotent as long as
 * the arguments match, which is exactly why they all live in this one function.
 */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGES.events, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.retry, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.dead, 'topic', { durable: true });

  // Delay queues: no consumer, a TTL, and a dead-letter back to the main exchange.
  for (const delay of RETRY_DELAYS_MS) {
    const name = delayQueueName(delay);
    await channel.assertQueue(name, {
      durable: true,
      arguments: {
        'x-message-ttl': delay,
        'x-dead-letter-exchange': EXCHANGES.events,
      },
    });
    await channel.bindQueue(name, EXCHANGES.retry, `${delay}.#`);
  }

  // Working queues, each dead-lettering into the retry exchange.
  for (const [queue, patterns] of Object.entries(BINDINGS) as [QueueName, readonly string[]][]) {
    if (queue === QUEUES.parked) continue;

    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGES.dead,
        // Quorum queues survive a node loss without the split-brain risk of classic mirroring.
        'x-queue-type': 'quorum',
      },
    });

    for (const pattern of patterns) {
      await channel.bindQueue(queue, EXCHANGES.events, pattern);
    }
  }

  // Terminal parking. A message here is an incident with a real order behind it.
  await channel.assertQueue(QUEUES.parked, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(QUEUES.parked, EXCHANGES.dead, '#');

  logger.info(
    { exchanges: Object.values(EXCHANGES), queues: Object.values(QUEUES) },
    'AMQP topology asserted',
  );
}

export function retryRoutingKey(delayMs: number, originalKey: string): string {
  return `${delayMs}.${originalKey}`;
}

/** Delay for the next attempt, or undefined when the message should be parked. */
export function nextDelay(attempt: number): number | undefined {
  return RETRY_DELAYS_MS[attempt];
}
