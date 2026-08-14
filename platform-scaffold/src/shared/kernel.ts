// Shared kernel: Money value object, in-process event bus, ids, domain-event type.
// NOTE: money is a typed value object and is NEVER produced by AI — deterministic only.

export type Currency = 'IRR' | 'AED' | 'USD' | 'TRY' | 'EUR' | 'GBP';

export interface Money {
  readonly amount: number;   // integer minor-unit-agnostic; kept as number for the scaffold
  readonly currency: Currency;
}

export const money = (amount: number, currency: Currency): Money => ({
  amount: Math.round(amount),
  currency,
});

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} + ${b.currency} — convert via FX first`);
  }
  return money(a.amount + b.amount, a.currency);
}

export function scaleMoney(a: Money, factor: number): Money {
  return money(a.amount * factor, a.currency);
}

export function formatMoney(m: Money): string {
  return `${new Intl.NumberFormat('en-US').format(m.amount)} ${m.currency}`;
}

// ---- ids ----
let counter = 0;
export const genId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---- events ----
export interface DomainEvent {
  type: string;
  at: string;         // ISO timestamp
  payload: Record<string, unknown>;
}

export type EventHandler = (e: DomainEvent) => void;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private log: DomainEvent[] = [];

  on(type: string, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(type: string, payload: Record<string, unknown>): DomainEvent {
    const e: DomainEvent = { type, at: new Date().toISOString(), payload };
    this.log.push(e);
    for (const h of this.handlers.get(type) ?? []) h(e);
    for (const h of this.handlers.get('*') ?? []) h(e);
    return e;
  }

  history(): readonly DomainEvent[] {
    return this.log;
  }
}
