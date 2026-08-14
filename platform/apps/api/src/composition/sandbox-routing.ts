import { sandboxSessionId } from '@xb/observability';
import { buildContext, createSandboxAdapters, type AsyncSandboxSessionStore } from '@xb/sandbox';
import type { AdapterSet } from './adapters.ts';

/**
 * Request-scoped adapter routing.
 *
 * When a request carries `X-Sandbox-Session` — or a worker is handling an event for an order
 * created inside one — its port calls must reach the simulated adapters for that session.
 * Otherwise they reach the production ones. The constraint is that **no service may know
 * which**, because the moment a service branches on "am I in a sandbox", the sandbox stops
 * proving anything about the real path.
 *
 * So the swap happens below the service layer: each port token is bound to a proxy that
 * resolves its adapter per call from the ambient context. Services inject a port, call a
 * method, and are unaware two implementations exist.
 *
 * Sessions live in Redis, so the proxy is async. Every port method is already async, so this
 * is invisible to callers — but it does mean the few *synchronous* members of a port
 * (`supports`, `verifyWebhook`, `mode`) cannot be routed and always come from production.
 * That is acceptable: none of them depends on scenario state.
 */

export type SandboxPortName = 'store' | 'fx' | 'payment' | 'procurement' | 'carrier';

/** Synchronous port members — cannot await a session load, so they use production. */
const SYNCHRONOUS_MEMBERS = new Set(['supports', 'verifyWebhook', 'mode', 'name']);

export function routeByContext<K extends SandboxPortName>(
  port: K,
  production: AdapterSet,
  store: AsyncSandboxSessionStore,
): AdapterSet[K] {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;

      const productionPort = production[port] as unknown as Record<string, unknown>;

      if (SYNCHRONOUS_MEMBERS.has(prop)) {
        const value = productionPort[prop];
        return typeof value === 'function' ? value.bind(productionPort) : value;
      }

      const productionValue = productionPort[prop];
      if (typeof productionValue !== 'function') return productionValue;

      return async (...args: unknown[]): Promise<unknown> => {
        const sessionId = sandboxSessionId();
        if (!sessionId) return (productionValue as (...a: unknown[]) => unknown).apply(productionPort, args);

        const session = await store.get(sessionId);
        // An unknown or expired session degrades to production rather than failing the
        // request. A demo whose session timed out should not return a 500.
        if (!session) {
          return (productionValue as (...a: unknown[]) => unknown).apply(productionPort, args);
        }

        const adapters = createSandboxAdapters(() => buildContext(session));
        const target = adapters[port] as unknown as Record<string, unknown>;
        const method = target[prop];

        if (typeof method !== 'function') {
          throw new TypeError(`Sandbox ${port} adapter has no method ${prop}`);
        }

        try {
          return await (method as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } finally {
          // Adapters mutate the session — appending to the log, anchoring the clock on
          // purchase, incrementing counters. Persist it so the next call, in this process or
          // another, sees the same state.
          await store.save(session);
        }
      };
    },
  }) as unknown as AdapterSet[K];
}
