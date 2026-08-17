import { Redis } from 'ioredis';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Money, uuidv7, type DomainEvent } from '@xb/core';
import { isSandboxPermitted, loadEnv } from '@xb/contracts';
import { logger, metrics, runWithContext, deriveWorkerContext, createContext } from '@xb/observability';
import { Broker, OutboxRelay, QUEUES, type OutboxSource } from '@xb/messaging';
import { RedisSandboxSessionStore } from '@xb/sandbox';
import {
  createDatabase,
  closeDatabase,
  OrderRepository,
  OutboxRepository,
  ProcessedEventRepository,
  ProcurementRepository,
  QuoteRepository,
  ShipmentRepository,
  shipments as shipmentsTable,
  ExceptionRepository,
  UnitOfWork,
  exceptions as exceptionsTable,
  fxSnapshots,
  type Database,
} from '@xb/db';
import { assertTransition, normalizeCarrierStatus } from '../../api/src/domain/order-state-machine.ts';
import { buildAdapters, createRedis } from '../../api/src/composition/adapters.ts';
import { routeByContext } from '../../api/src/composition/sandbox-routing.ts';

/**
 * The worker process.
 *
 * Shares the domain code and the adapter wiring with the API — the same ports, the same
 * proxy chain, the same state machine. What differs is only what triggers the work: an AMQP
 * message rather than an HTTP request.
 *
 * Every consumer is idempotent. Delivery is at-least-once by design (see the outbox relay),
 * so a handler that is not idempotent will eventually double-charge, double-ship or
 * double-post. `ProcessedEventRepository` is the guard.
 */

async function main(): Promise<void> {
  const env = loadEnv();
  // Resolved once, from the same policy the API's composition root and controllers use.
  const sandboxPermitted = isSandboxPermitted(env);
  const db = createDatabase({ url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX });
  const redis = createRedis(env);
  const production = buildAdapters({ env, redis });
  const sandboxStore = new RedisSandboxSessionStore(redis);

  // The worker resolves ports through the same context router the API uses, so an event for
  // an order created in a sandbox session reaches that session's simulated adapters. Without
  // this the worker would silently run sandbox orders against production adapters and the
  // demo would stall permanently at PROCUREMENT_PENDING.
  const adapters = {
    ...production,
    store: routeByContext('store', production, sandboxStore),
    fx: routeByContext('fx', production, sandboxStore),
    payment: routeByContext('payment', production, sandboxStore),
    procurement: routeByContext('procurement', production, sandboxStore),
    carrier: routeByContext('carrier', production, sandboxStore),
  };
  const uow = new UnitOfWork(db);

  const broker = new Broker({ url: env.AMQP_URL, prefetch: env.AMQP_PREFETCH });
  await broker.connect();

  // ── outbox relay: the only publisher in the system ──
  const relay = new OutboxRelay(broker, {
    batchSize: 100,
    intervalMs: 500,
    runInTransaction: (fn) =>
      db.transaction(async (tx) => {
        const repo = new OutboxRepository(tx);
        const source: OutboxSource = {
          claimBatch: (limit) => repo.claimBatch(limit) as never,
          markPublished: (ids) => repo.markPublished(ids),
          markFailed: (id, error) => repo.markFailed(id, error),
          lagSeconds: () => repo.lagSeconds(),
        };
        return fn(source);
      }),
  });
  relay.start();

  const processed = new ProcessedEventRepository(db);

  /**
   * Wrap a handler in the dedupe check and the originating sandbox session.
   *
   * Dedupe first: delivery is at-least-once, so a handler that is not idempotent will
   * eventually double-purchase or double-post.
   *
   * Then, if the order carries a sandboxSessionId, re-enter that session's context so the
   * ports resolve to its simulated adapters. The handler itself is unaware either happened.
   */
  const once = (consumer: string, handler: (e: DomainEvent) => Promise<void>) =>
    async (event: DomainEvent): Promise<void> => {
      if (!(await processed.markProcessed(event.id, consumer))) {
        logger.debug({ eventId: event.id, consumer }, 'duplicate delivery ignored');
        return;
      }

      const orderId = (event.payload as { orderId?: string } | null)?.orderId;
      let sandboxSessionId: string | undefined;

      // Only where the sandbox is permitted in this process. The session id is read from the
      // order row, so without this gate a row stamped in some other environment would swap in
      // simulated adapters here — sandbox routing in a worker with no sandbox to speak of.
      if (orderId && sandboxPermitted) {
        const order = await new OrderRepository(db).findById(orderId);
        sandboxSessionId = order?.sandboxSessionId ?? undefined;
      }

      if (!sandboxSessionId) return handler(event);

      return runWithContext(
        createContext({
          correlationId: event.correlationId,
          sandboxSessionId,
          source: 'worker',
        }),
        () => handler(event),
      );
    };

  // ── procurement: on payment, create the procurement order and check the guard ──
  await broker.consume(
    QUEUES.procurement,
    once('procurement', async (event) => {
      if (event.type !== 'order.paid') return;

      const orderId = String((event.payload as { orderId: string }).orderId);
      const order = await new OrderRepository(db).requireById(orderId);
      const quote = await new QuoteRepository(db).requireById(order.quoteId);
      const snapshot = quote.productSnapshot as { marketplace: string; externalProductId: string };

      const procurement = await new ProcurementRepository(db).create({
        id: uuidv7(),
        orderId: order.id,
        marketplace: snapshot.marketplace,
        externalProductId: snapshot.externalProductId,
        quantity: quote.quantity,
        expectedPriceMinor: quote.maxProcurementMinor,
        currency: quote.maxProcurementCurrency,
        status: 'PENDING',
      });

      const result = await adapters.procurement.purchase({
        procurementOrderId: procurement.id,
        marketplaceId: snapshot.marketplace as never,
        externalProductId: snapshot.externalProductId,
        quantity: quote.quantity,
        expectedPrice: Money.of(Number(quote.maxProcurementMinor), quote.maxProcurementCurrency),
        maxPrice: Money.of(Number(order.maxProcurementMinor), order.maxProcurementCurrency),
        idempotencyKey: `proc-${procurement.id}`,
      });

      // Guard breach or stock-out: branch the order and raise an exception. Never buy.
      if (!result.ok && result.reason !== 'REQUIRES_OPERATOR') {
        const target = result.reason === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'PRICE_CHANGED';

        await uow.run(async (ctx) => {
          const repo = new OrderRepository(ctx.tx);
          assertTransition(order.state as never, target);
          await repo.transition({
            orderId: order.id,
            from: order.state,
            to: target,
            actor: 'worker:procurement',
            reason: `guard: ${result.reason}`,
            correlationId: event.correlationId,
          });

          await new ExceptionRepository(ctx.tx).raise({
            id: uuidv7(),
            orderId: order.id,
            type: target,
            state: target,
            marginAtRiskMinor: quote.finalAmountMinor,
            currency: quote.finalCurrency,
            rank: '0',
          });

          ctx.emit({
            topic: 'exception.raised',
            aggregateId: order.id,
            aggregateType: 'order',
            payload: { orderId: order.id, type: target },
          });
        });

        logger.warn({ orderId, reason: result.reason }, 'procurement blocked; exception raised');
        return;
      }

      // Within the guard: an operator task is waiting in the back office.
      logger.info({ orderId, procurementId: procurement.id }, 'procurement task ready for operator');
    }),
  );

  // ── tracking: poll the carrier and normalise into the unified lifecycle ──
  await broker.consume(
    QUEUES.tracking,
    once('tracking', async (event) => {
      if (event.type !== 'procurement.purchased') return;

      const orderId = String((event.payload as { orderId: string }).orderId);
      const shipmentRepo = new ShipmentRepository(db);

      const created = await adapters.carrier.createShipment({
        orderId,
        weightKg: 1,
        origin: 'Dubai, UAE',
        destination: 'Tehran, IR',
      });

      await shipmentRepo.create({
        id: uuidv7(),
        orderId,
        carrierShipmentId: created.shipmentId,
        status: 'CREATED',
        lastEventAt: new Date(),
      });

      logger.info({ orderId, shipmentId: created.shipmentId }, 'shipment created');
    }),
  );

  // ── notifications ──
  await broker.consume(
    QUEUES.notification,
    once('notification', async (event) => {
      // Deduped by event id, so one state change sends exactly one message even when the
      // event is redelivered.
      logger.info({ type: event.type, aggregateId: event.aggregateId }, 'notification queued');
    }),
  );

  // ── reconciliation ──
  await broker.consume(
    QUEUES.reconciliation,
    once('reconciliation', async (event) => {
      logger.debug({ type: event.type }, 'reconciliation event received');
    }),
  );

  // ── FX refresh: keeps the snapshot warm so checkout rarely waits on a provider ──
  const refreshFx = async (): Promise<void> => {
    await runWithContext(deriveWorkerContext(uuidv7()), async () => {
      for (const pair of [
        ['AED', 'IRR'],
        ['USD', 'IRR'],
      ] as const) {
        try {
          const quote = await adapters.fx.getRate(pair[0], pair[1]);
          await db.insert(fxSnapshots).values({
            baseCurrency: pair[0],
            quoteCurrency: pair[1],
            rateMicro: BigInt(Math.round(quote.rate * 1_000_000)),
            source: quote.source,
            observedAt: new Date(quote.observedAt),
          });
        } catch (e) {
          // A failed refresh is survivable: the cached snapshot stays until its ceiling,
          // and the quote engine refuses to price past that rather than guessing.
          logger.warn({ pair, err: e }, 'FX refresh failed');
        }
      }
    });
  };

  await refreshFx();
  const fxTimer = setInterval(() => void refreshFx(), 180_000);
  fxTimer.unref?.();

  /**
   * Tracking poller.
   *
   * Creating a shipment is not enough — something has to ask the carrier what happened and
   * move the order through its lifecycle. This is that loop.
   *
   * Each shipment is polled inside its own order's sandbox session (when it has one), so the
   * virtual clock decides which legs are visible. In production the same loop runs against a
   * real carrier and the wall clock, with no code difference.
   *
   * Carrier statuses are normalised before they touch the order, so a forwarder inventing a
   * new status string can never leak into a customer's tracking page.
   */
  const pollTracking = async (): Promise<void> => {
    const active = await db
      .select()
      .from(shipmentsTable)
      .where(sql`${shipmentsTable.status} <> 'DELIVERED'`)
      .limit(50);

    for (const shipment of active) {
      const order = await new OrderRepository(db).findById(shipment.orderId);
      if (!order) continue;

      const run = async (): Promise<void> => {
        const legs = await adapters.carrier.track(shipment.carrierShipmentId ?? shipment.id);
        const shipmentRepo = new ShipmentRepository(db);
        const orderRepo = new OrderRepository(db);

        for (const leg of legs) {
          if (leg.events.length === 0) continue;

          // Dedupe on (shipment, status+timestamp) so re-polling the same feed does not
          // duplicate the timeline.
          await shipmentRepo.appendEvents(
            shipment.id,
            leg.events.map((e) => ({
              shipmentId: shipment.id,
              status: e.status,
              rawStatus: e.rawStatus,
              location: e.location ?? null,
              occurredAt: new Date(e.at),
              dedupeKey: `${e.rawStatus}:${e.at}`,
            })),
          );

          // Walk the order forward through whichever transitions the carrier justifies.
          for (const event of leg.events) {
            const target = normalizeCarrierStatus(event.status);
            if (!target) {
              logger.warn({ rawStatus: event.status }, 'unmapped carrier status; ignored');
              continue;
            }

            const current = await orderRepo.findById(order.id);
            if (!current || current.state === target) continue;

            try {
              assertTransition(current.state as never, target);
            } catch {
              continue; // not a legal next step from here; a later leg may be
            }

            await uow.run(async (ctx) => {
              await new OrderRepository(ctx.tx).transition({
                orderId: order.id,
                from: current.state,
                to: target,
                actor: 'worker:tracking',
                reason: `carrier: ${event.rawStatus}`,
                correlationId: uuidv7(),
              });

              ctx.emit({
                topic: 'shipment.leg_updated',
                aggregateId: order.id,
                aggregateType: 'order',
                payload: { orderId: order.id, to: target },
              });
            });

            logger.info({ orderId: order.id, to: target }, 'order advanced by tracking');

            if (target === 'DELIVERED') {
              await db
                .update(shipmentsTable)
                .set({ status: 'DELIVERED' })
                .where(eq(shipmentsTable.id, shipment.id));
            }
          }
        }
      };

      // Same environment gate as the event consumer above — a stamped row must not re-enter
      // sandbox routing in a process where the sandbox is not permitted.
      if (order.sandboxSessionId && sandboxPermitted) {
        await runWithContext(
          createContext({
            correlationId: uuidv7(),
            sandboxSessionId: order.sandboxSessionId,
            source: 'worker',
          }),
          run,
        );
      } else {
        await run();
      }
    }
  };

  const trackingTimer = setInterval(() => void pollTracking().catch((e) => {
    logger.error({ err: e }, 'tracking poll failed');
  }), 5_000);
  trackingTimer.unref?.();

  // ── stall detector ──
  const detectStalls = async (): Promise<void> => {
    const stalled = await new ShipmentRepository(db).findStalled(48);
    for (const shipment of stalled) {
      logger.warn({ shipmentId: shipment.id, orderId: shipment.orderId }, 'shipment stalled');
    }
  };

  const stallTimer = setInterval(() => void detectStalls(), 600_000);
  stallTimer.unref?.();

  logger.info('worker ready');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    clearInterval(fxTimer);
    clearInterval(stallTimer);
    clearInterval(trackingTimer);
    await relay.stop();
    await broker.close();
    await closeDatabase();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error({ err: e }, 'worker failed to start');
  process.exit(1);
});
