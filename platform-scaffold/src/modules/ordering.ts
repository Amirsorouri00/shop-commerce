// Ordering module: resolve -> quote -> order -> pay -> procure -> track.
// Orchestrates ports; emits domain events; enforces the money/state rules.

import { Order, carrierStatusToState } from '../domain/order.ts';
import { money } from '../shared/kernel.ts';
import type { EventBus } from '../shared/kernel.ts';
import type { QuoteEngine, Quote } from './pricing.ts';
import type { QuoteRepo, OrderRepo, Ledger } from '../repos.ts';
import type {
  StoreAdapter, PaymentGateway, ProcurementExecutor, CarrierAdapter,
} from '../ports.ts';

export interface Deps {
  bus: EventBus;
  store: StoreAdapter;
  quoteEngine: QuoteEngine;
  payment: PaymentGateway;
  procurement: ProcurementExecutor;
  carrier: CarrierAdapter;
  quotes: QuoteRepo;
  orders: OrderRepo;
  ledger: Ledger;
}

export class OrderingService {
  private d: Deps;
  constructor(d: Deps) { this.d = d; }

  async resolveAndQuote(url: string, customerId: string): Promise<Quote> {
    if (!this.d.store.supports(url)) throw new Error('Unsupported marketplace URL');
    const product = await this.d.store.resolve(url);
    this.d.bus.emit('ProductResolved', { url, id: product.externalProductId, via: product.resolvedVia });
    if (!product.available) throw new Error('OUT_OF_STOCK');
    const quote = await this.d.quoteEngine.createQuote(product);
    this.d.quotes.save(quote);
    this.d.bus.emit('QuoteCreated', { quoteId: quote.id, finalIRR: quote.finalPrice.amount, viable: quote.viable });
    return quote;
  }

  createOrder(quoteId: string, customerId: string): Order {
    const quote = this.d.quotes.get(quoteId);
    if (!quote) throw new Error('Quote not found');
    if (!quote.viable) throw new Error('Order blocked: below viability threshold (min-order gate)');
    const order = new Order(customerId, quoteId, quote.maxProcurementPrice);
    order.transition('QUOTING');
    order.transition('QUOTED');
    order.transition('AWAITING_PAYMENT');
    this.d.orders.save(order);
    this.d.bus.emit('OrderCreated', { orderId: order.id, quoteId });
    return order;
  }

  async pay(orderId: string): Promise<Order> {
    const order = this.d.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    const quote = this.d.quotes.get(order.quoteId)!;
    // RULE: revalidate would happen here (offer + availability + FX). Stub: assume fresh.
    const res = await this.d.payment.charge(order.id, quote.finalPrice);
    if (!res.ok) { order.transition('PAYMENT_FAILED'); this.d.orders.save(order); throw new Error('Payment failed'); }
    order.transition('PAID', `gateway ${res.gatewayRef}`);
    // Customer-side ledger: cash in (IRR)
    this.d.ledger.post('customer_cash_IRR', quote.finalPrice.amount, 0, 'IRR', order.id);
    this.d.ledger.post('customer_liability_IRR', 0, quote.finalPrice.amount, 'IRR', order.id);
    this.d.bus.emit('PaymentConfirmed', { orderId: order.id, amountIRR: quote.finalPrice.amount });
    order.transition('PROCUREMENT_PENDING');
    this.d.orders.save(order);
    return order;
  }

  // Assisted procurement: prepares context; "operator confirm" is the call to this method.
  async procure(orderId: string): Promise<Order> {
    const order = this.d.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    const quote = this.d.quotes.get(order.quoteId)!;
    const res = await this.d.procurement.purchase({
      procurementOrderId: `PO-${order.id}`,
      marketplace: quote.productSnapshot.marketplace,
      externalProductId: quote.productSnapshot.externalProductId,
      expectedPrice: quote.productSnapshot.price,
      maxPrice: order.maxProcurementPrice,
    });
    if (!res.ok) {
      order.transition(res.reason ?? 'PROCUREMENT_FAILED', `actual ${res.actualPrice.amount} > max ${order.maxProcurementPrice.amount}`);
      this.d.orders.save(order);
      this.d.bus.emit('ProcurementFailed', { orderId: order.id, reason: res.reason });
      return order;
    }
    order.transition('PURCHASED', `ext ${res.externalOrderId}`);
    // Procurement-side ledger: foreign spend (AED)
    this.d.ledger.post('procurement_spend_AED', res.actualPrice.amount, 0, res.actualPrice.currency, order.id);
    this.d.bus.emit('ProcurementPurchased', { orderId: order.id, externalOrderId: res.externalOrderId });
    this.d.orders.save(order);
    return order;
  }

  // Approve a reprice after PRICE_CHANGED (customer accepted new price).
  approveReprice(orderId: string, newMax: number): Order {
    const order = this.d.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    order.maxProcurementPrice = money(newMax, order.maxProcurementPrice.currency);
    order.transition('PROCUREMENT_PENDING', 'customer approved reprice');
    this.d.orders.save(order);
    return order;
  }

  async fulfil(orderId: string): Promise<Order> {
    const order = this.d.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    const shipmentId = await this.d.carrier.createShipment(order.id);
    const events = await this.d.carrier.track(shipmentId);
    for (const ev of events) {
      const target = carrierStatusToState(ev.status);
      if (target && order.canTransition(target)) {
        order.transition(target, `carrier: ${ev.status}`);
        this.d.bus.emit('LegUpdated', { orderId: order.id, status: target });
      }
    }
    this.d.orders.save(order);
    return order;
  }
}
