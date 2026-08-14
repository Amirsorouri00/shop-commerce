// Composition root — wire the core to the (stub) adapters. This is the ONLY place that
// knows which adapter is live. Swap a stub for a real provider here when its gate clears.

import { EventBus } from './shared/kernel.ts';
import {
  AmazonAeStubStore, StubFx, StubPayment, AssistedProcurement, StubCarrier, StubCustoms,
} from './adapters.ts';
import { QuoteEngine } from './modules/pricing.ts';
import { OrderingService } from './modules/ordering.ts';
import { QuoteRepo, OrderRepo, Ledger } from './repos.ts';

export interface AppOptions {
  // demo hook: simulate a marketplace price move at procurement time
  procurementPriceOverride?: number;
}

export interface App {
  bus: EventBus;
  ordering: OrderingService;
  orders: OrderRepo;
  quotes: QuoteRepo;
  ledger: Ledger;
}

export function buildApp(opts: AppOptions = {}): App {
  const bus = new EventBus();
  const fx = new StubFx();
  const customs = new StubCustoms();
  const quoteEngine = new QuoteEngine(fx, customs);
  const quotes = new QuoteRepo();
  const orders = new OrderRepo();
  const ledger = new Ledger();

  const ordering = new OrderingService({
    bus,
    store: new AmazonAeStubStore(),
    quoteEngine,
    payment: new StubPayment(),
    procurement: new AssistedProcurement(opts.procurementPriceOverride),
    carrier: new StubCarrier(),
    quotes,
    orders,
    ledger,
  });

  return { bus, ordering, orders, quotes, ledger };
}
