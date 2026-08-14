import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { isRetryable, type DomainEvent } from '@xb/core';
import { logger, metrics, METRIC, runWithContext, deriveWorkerContext } from '@xb/observability';
import {
  assertTopology,
  EXCHANGES,
  MAX_ATTEMPTS,
  nextDelay,
  retryRoutingKey,
  type QueueName,
} from './topology.ts';

/**
 * The broker connection, publisher and consumer runtime.
 *
 * Publishing goes through a confirm channel: a `publish` that returns without an ack is a
 * message that may not exist. Since the outbox relay marks rows published on the strength of
 * that call, an unconfirmed publish would let an event be lost *and* recorded as delivered.
 */

export interface BrokerOptions {
  readonly url: string;
  readonly prefetch?: number;
  readonly reconnectDelayMs?: number;
}

export type Handler = (event: DomainEvent, raw: ConsumeMessage) => Promise<void>;

export class Broker {
  private connection: ChannelModel | undefined;
  private publishChannel: Awaited<ReturnType<ChannelModel['createConfirmChannel']>> | undefined;
  private consumeChannel: Channel | undefined;
  private closing = false;
  private readonly handlers = new Map<QueueName, Handler>();

  constructor(private readonly options: BrokerOptions) {}

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(this.options.url);

    this.connection.on('error', (err) => logger.error({ err }, 'AMQP connection error'));
    this.connection.on('close', () => {
      if (!this.closing) {
        logger.warn('AMQP connection closed; reconnecting');
        setTimeout(() => void this.reconnect(), this.options.reconnectDelayMs ?? 3_000);
      }
    });

    this.publishChannel = await this.connection.createConfirmChannel();
    this.consumeChannel = await this.connection.createChannel();
    await this.consumeChannel.prefetch(this.options.prefetch ?? 16);

    await assertTopology(this.consumeChannel);
    logger.info('AMQP connected');
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect();
      for (const [queue, handler] of this.handlers) {
        await this.consume(queue, handler);
      }
    } catch (e) {
      logger.error({ err: e }, 'AMQP reconnect failed; retrying');
      setTimeout(() => void this.reconnect(), this.options.reconnectDelayMs ?? 3_000);
    }
  }

  /**
   * Publish and wait for the broker's confirmation.
   *
   * Resolves only once RabbitMQ has accepted responsibility for the message.
   */
  async publish(event: DomainEvent): Promise<void> {
    const channel = this.publishChannel;
    if (!channel) throw new Error('Broker not connected');

    const body = Buffer.from(JSON.stringify(event));

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGES.events,
        event.type,
        body,
        {
          persistent: true,
          messageId: event.id,
          correlationId: event.correlationId,
          timestamp: Date.parse(event.occurredAt),
          contentType: 'application/json',
          headers: { 'x-attempt': 0, 'x-aggregate-type': event.aggregateType },
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });

    metrics.counter(METRIC.queuePublish, 1, { topic: event.type });
  }

  async consume(queue: QueueName, handler: Handler): Promise<void> {
    const channel = this.consumeChannel;
    if (!channel) throw new Error('Broker not connected');

    this.handlers.set(queue, handler);

    await channel.consume(queue, (msg) => {
      if (!msg) return;
      void this.dispatch(queue, msg, handler);
    });

    logger.info({ queue }, 'consumer started');
  }

  /**
   * Run one message through its handler and decide ack / retry / park.
   *
   * The correlation id from the publishing request is restored into the async context, so a
   * worker's logs and spans join the trace of the HTTP request that ultimately caused them.
   */
  private async dispatch(queue: QueueName, msg: ConsumeMessage, handler: Handler): Promise<void> {
    const channel = this.consumeChannel;
    if (!channel) return;

    const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 0);
    let event: DomainEvent;

    try {
      event = JSON.parse(msg.content.toString()) as DomainEvent;
    } catch (e) {
      // Unparseable content will never parse. Park it immediately rather than retrying.
      logger.error({ queue, err: e }, 'unparseable message; parking');
      channel.nack(msg, false, false);
      return;
    }

    const context = deriveWorkerContext(event.correlationId);
    const started = performance.now();

    await runWithContext(context, async () => {
      try {
        await handler(event, msg);
        channel.ack(msg);

        metrics.counter(METRIC.queueConsume, 1, { queue, outcome: 'ack' });
        metrics.histogram(`${METRIC.queueConsume}.duration_ms`, performance.now() - started, {
          queue,
        });
      } catch (e) {
        await this.handleFailure(queue, msg, event, attempt, e);
      }
    });
  }

  private async handleFailure(
    queue: QueueName,
    msg: ConsumeMessage,
    event: DomainEvent,
    attempt: number,
    error: unknown,
  ): Promise<void> {
    const channel = this.consumeChannel;
    const publisher = this.publishChannel;
    if (!channel || !publisher) return;

    const permanent = !isRetryable(error);
    const delay = nextDelay(attempt);

    // A non-retryable failure will fail identically next time; parking it now surfaces it to
    // a human immediately instead of after fifteen minutes of pointless backoff.
    if (permanent || delay === undefined) {
      logger.error(
        { queue, eventId: event.id, type: event.type, attempt, permanent, err: error },
        'parking message for manual triage',
      );
      metrics.counter(METRIC.queueConsume, 1, { queue, outcome: 'parked' });
      channel.nack(msg, false, false); // routes to the dead-letter exchange -> q.parked
      return;
    }

    logger.warn(
      { queue, eventId: event.id, type: event.type, attempt: attempt + 1, delayMs: delay },
      'scheduling retry',
    );
    metrics.counter(METRIC.queueConsume, 1, { queue, outcome: 'retry' });

    // Republish into the delay queue with an incremented attempt count, then ack the
    // original so it leaves this queue. Ack order matters: acking first could lose the
    // message if the republish fails, so the republish is confirmed before the ack.
    await new Promise<void>((resolve, reject) => {
      publisher.publish(
        EXCHANGES.retry,
        retryRoutingKey(delay, event.type),
        msg.content,
        {
          ...msg.properties,
          persistent: true,
          headers: { ...msg.properties.headers, 'x-attempt': attempt + 1 },
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });

    channel.ack(msg);
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.publishChannel?.close().catch(() => undefined);
    await this.consumeChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    logger.info('AMQP closed');
  }

  async healthcheck(): Promise<boolean> {
    return this.connection !== undefined && this.publishChannel !== undefined;
  }
}

export { MAX_ATTEMPTS };
