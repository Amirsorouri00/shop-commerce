// In-memory repositories (swap for Postgres later — same interface shape).

import type { Quote } from './modules/pricing.ts';
import type { Order } from './domain/order.ts';

export class QuoteRepo {
  private store = new Map<string, Quote>();
  save(q: Quote): void { this.store.set(q.id, q); }
  get(id: string): Quote | undefined { return this.store.get(id); }
}

export class OrderRepo {
  private store = new Map<string, Order>();
  save(o: Order): void { this.store.set(o.id, o); }
  get(id: string): Order | undefined { return this.store.get(id); }
  all(): Order[] { return [...this.store.values()]; }
}

// A tiny double-entry ledger to demonstrate the "money is deterministic" rule.
export interface LedgerEntry {
  account: string; debit: number; credit: number; currency: string; ref: string; at: string;
}
export class Ledger {
  private entries: LedgerEntry[] = [];
  post(account: string, debit: number, credit: number, currency: string, ref: string): void {
    this.entries.push({ account, debit, credit, currency, ref, at: new Date().toISOString() });
  }
  all(): readonly LedgerEntry[] { return this.entries; }
}
