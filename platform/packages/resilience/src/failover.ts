import { ProviderUnavailableError, isAppError } from '@xb/core';
import { logger, metrics } from '@xb/observability';
import { breakerRegistry, type BreakerRegistry } from './circuit-breaker.ts';
import type { NamedProvider } from './pipeline.ts';

/**
 * Multi-provider selection and failover.
 *
 * One implementation serves payment, identity, FX and SMS. What differs between them is the
 * *strategy*, not the machinery — so adding a provider is one adapter plus one registry
 * entry, and adding a corridor doesn't touch this file at all.
 *
 * Strategies:
 *
 *   priority     Lowest priority number first, skipping quarantined providers. The default,
 *                and the right choice when providers differ in cost or reliability.
 *
 *   round-robin  Spread load across equals. Used for SMS, where per-message cost is flat and
 *                vendors impose their own throughput caps.
 *
 *   capability   Ask each provider whether it handles this input. Used for store resolution,
 *                where the marketplace URL determines the only possible adapter.
 *
 *   sticky       Priority for the first call, then pinned for that key forever. Used for
 *                payments: once an order has an intent with a gateway, every retry must go
 *                back to the same gateway. Failing over mid-payment risks a double charge,
 *                and no amount of reconciliation fully undoes one.
 */

export type SelectionStrategy = 'priority' | 'round-robin' | 'capability' | 'sticky';

/**
 * Does any registered provider actually implement this method?
 *
 * The failover proxy has an empty target, so without this check it synthesises a callable for
 * *every* property name. That breaks in two ways that are painful to diagnose:
 *
 *   - `await port` sees a `then` method, treats the port as a promise, and calls
 *     `then(resolve, reject)` — dispatched to a provider as if `then` were a business method.
 *   - A DI container probing for lifecycle hooks (`onModuleInit`, `onApplicationShutdown`)
 *     finds them all present and calls them.
 *
 * A denylist of known probe names would work until the next framework invents one. Asking the
 * providers what they actually implement is correct by construction: if no adapter has the
 * method, the port does not have it either.
 */
function anyProviderImplements<T extends object>(
  registry: ProviderRegistry<T>,
  method: string,
): boolean {
  return registry
    .all()
    .some((entry) => typeof (entry.adapter as Record<string, unknown>)[method] === 'function');
}

export interface ProviderEntry<T extends object> {
  readonly name: string;
  readonly adapter: T;
  /** Lower is preferred. */
  readonly priority: number;
  readonly enabled?: boolean;
  /** For `capability`: does this provider handle this call? */
  readonly supports?: (method: string, args: readonly unknown[]) => boolean;
}

export interface FailoverOptions<T extends object> {
  readonly port: string;
  readonly strategy?: SelectionStrategy;
  /**
   * For `sticky`: derive the pin key from the call. Returning undefined falls back to
   * priority selection for that call.
   */
  readonly stickyKey?: (method: string, args: readonly unknown[]) => string | undefined;
  /** Where sticky pins live. In production this is Redis-backed so pins survive a restart. */
  readonly stickyStore?: StickyStore;
  /** Methods that must not fail over even under `priority` — non-idempotent operations. */
  readonly noFailoverMethods?: readonly string[];
  readonly breakers?: BreakerRegistry;
}

export interface StickyStore {
  get(key: string): Promise<string | undefined> | string | undefined;
  set(key: string, provider: string): Promise<void> | void;
}

/** Default in-memory pin store. Replace with the Redis-backed one outside development. */
export class MemoryStickyStore implements StickyStore {
  private readonly pins = new Map<string, string>();
  get(key: string): string | undefined {
    return this.pins.get(key);
  }
  set(key: string, provider: string): void {
    this.pins.set(key, provider);
  }
}

export class ProviderRegistry<T extends object> {
  private readonly entries: ProviderEntry<T>[] = [];
  private rrCursor = 0;

  constructor(
    readonly port: string,
    entries: readonly ProviderEntry<T>[] = [],
  ) {
    for (const e of entries) this.register(e);
  }

  register(entry: ProviderEntry<T>): this {
    this.entries.push(entry);
    this.entries.sort((a, b) => a.priority - b.priority);
    return this;
  }

  all(): readonly ProviderEntry<T>[] {
    return this.entries;
  }

  byName(name: string): ProviderEntry<T> | undefined {
    return this.entries.find((e) => e.name === name);
  }

  /** Candidates in the order they should be tried, quarantined providers last. */
  candidates(
    strategy: SelectionStrategy,
    method: string,
    args: readonly unknown[],
    breakers: BreakerRegistry,
  ): ProviderEntry<T>[] {
    let pool = this.entries.filter((e) => e.enabled !== false);

    if (strategy === 'capability') {
      pool = pool.filter((e) => e.supports?.(method, args) ?? true);
    }

    if (strategy === 'round-robin' && pool.length > 1) {
      const offset = this.rrCursor++ % pool.length;
      pool = [...pool.slice(offset), ...pool.slice(0, offset)];
    }

    // Quarantined providers move to the back rather than being removed: if every provider
    // is quarantined, trying a fail-fast one still beats refusing to try at all.
    const healthy = pool.filter((e) => !breakers.isQuarantined(`${this.port}:${e.name}`));
    const quarantined = pool.filter((e) => breakers.isQuarantined(`${this.port}:${e.name}`));
    return [...healthy, ...quarantined];
  }
}

/**
 * Build an object implementing the port that dispatches to whichever provider the strategy
 * selects, moving to the next on an infrastructure failure.
 */
export function failover<T extends object>(
  registry: ProviderRegistry<T>,
  options: FailoverOptions<T>,
): T & NamedProvider {
  const strategy = options.strategy ?? 'priority';
  const breakers = options.breakers ?? breakerRegistry;
  const stickyStore = options.stickyStore ?? new MemoryStickyStore();
  const noFailover = new Set(options.noFailoverMethods ?? []);

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === 'name') return `failover(${options.port})`;
      if (typeof prop !== 'string') return undefined;

      // Only expose methods a provider genuinely has — see `anyProviderImplements`.
      if (!anyProviderImplements(registry, prop)) return undefined;

      return async (...args: unknown[]): Promise<unknown> => {
        let ordered = registry.candidates(strategy, prop, args, breakers);

        // Sticky: if this key is already pinned, that provider is the only candidate.
        let pinKey: string | undefined;
        if (strategy === 'sticky' && options.stickyKey) {
          pinKey = options.stickyKey(prop, args);
          if (pinKey) {
            const pinned = await stickyStore.get(pinKey);
            if (pinned) {
              const entry = registry.byName(pinned);
              if (entry) {
                ordered = [entry];
              } else {
                logger.warn(
                  { port: options.port, pinKey, pinned },
                  'pinned provider no longer registered; falling back to priority order',
                );
              }
            }
          }
        }

        if (ordered.length === 0) {
          throw new ProviderUnavailableError(options.port, {
            details: { method: prop, strategy },
          });
        }

        let lastError: unknown;

        for (const entry of ordered) {
          try {
            const fn = (entry.adapter as Record<string, unknown>)[prop];
            if (typeof fn !== 'function') {
              throw new TypeError(`Provider ${entry.name} has no method ${prop}`);
            }

            const result = await (fn as (...a: unknown[]) => Promise<unknown>).apply(
              entry.adapter,
              args,
            );

            // Pin on first success so subsequent calls for this key stay put.
            if (pinKey) await stickyStore.set(pinKey, entry.name);

            metrics.counter('provider.selected', 1, {
              port: options.port,
              provider: entry.name,
              method: prop,
            });

            return result;
          } catch (e) {
            lastError = e;

            // A domain-level rejection is the provider's real answer, not a failure to reach
            // it. Trying the next provider would ask the same question and get the same no.
            if (isAppError(e) && e.httpStatus < 500 && e.code !== 'CIRCUIT_OPEN') throw e;

            if (noFailover.has(prop) || ordered.length === 1) throw e;

            logger.warn(
              {
                port: options.port,
                provider: entry.name,
                method: prop,
                errorCode: isAppError(e) ? e.code : 'UNKNOWN',
              },
              'provider failed, trying next',
            );

            metrics.counter('provider.failover', 1, {
              port: options.port,
              from: entry.name,
              method: prop,
            });
          }
        }

        throw lastError ?? new ProviderUnavailableError(options.port);
      };
    },
  };

  return new Proxy({} as Record<string, unknown>, handler) as T & NamedProvider;
}
