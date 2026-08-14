import { AsyncLocalStorage } from 'node:async_hooks';
import { uuid } from '@xb/core';

/**
 * Request context, carried implicitly.
 *
 * The alternative — threading a context object through every function signature — is what
 * makes teams give up on correlation ids halfway through. AsyncLocalStorage keeps the
 * context available anywhere in the async call tree without polluting a single signature.
 *
 * The correlation id survives the HTTP request, the outbox row, the AMQP message and the
 * worker that consumes it, so one id traces a customer action all the way to a ledger entry.
 */

export interface RequestContext {
  /** Correlates every log line, span and event produced by one logical operation. */
  readonly correlationId: string;
  /** Distinct per hop; the correlationId is shared across hops. */
  readonly requestId: string;
  readonly userId?: string | undefined;
  readonly role?: string | undefined;
  readonly locale: 'fa' | 'en';
  /** Set for work triggered by a queue message rather than an HTTP request. */
  readonly source: 'http' | 'worker' | 'system';
  /**
   * Sandbox session id from `X-Sandbox-Session`, when present.
   *
   * Carried in the ambient context rather than threaded through service signatures, so a
   * service never learns whether it is running against simulated adapters. That ignorance is
   * the point: a sandbox run exercises the same code path as production, which is what makes
   * it evidence rather than theatre.
   */
  readonly sandboxSessionId?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The correlation id, or a fresh one.
 *
 * Never returns undefined: a log line without a correlation id is a log line you cannot
 * follow, and silently omitting it is worse than inventing one at the edge.
 */
export function correlationId(): string {
  return storage.getStore()?.correlationId ?? uuid();
}

export function createContext(partial: Partial<RequestContext> = {}): RequestContext {
  const id = partial.correlationId ?? uuid();
  return {
    correlationId: id,
    requestId: partial.requestId ?? id,
    userId: partial.userId,
    role: partial.role,
    locale: partial.locale ?? 'fa',
    source: partial.source ?? 'http',
    sandboxSessionId: partial.sandboxSessionId,
  };
}

/** The active sandbox session, if this request is running inside one. */
export function sandboxSessionId(): string | undefined {
  return storage.getStore()?.sandboxSessionId;
}

/** Derive a child context for work handed to a queue, preserving the correlation id. */
export function deriveWorkerContext(correlation: string): RequestContext {
  return {
    correlationId: correlation,
    requestId: uuid(),
    locale: 'fa',
    source: 'worker',
  };
}
