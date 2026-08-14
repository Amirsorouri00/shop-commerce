import { uuid } from '@xb/core';
import { getScenario, type ScenarioId } from './scenario.ts';
import type { SandboxSession } from './session.ts';

/**
 * Redis-backed sandbox sessions.
 *
 * The in-memory store is fine for unit tests, but it is per-process — and the API and the
 * worker are different processes. With sessions in memory, a sandbox order would be paid in
 * the API and then reach a worker that has never heard of the session, so procurement and
 * shipment would silently run against production adapters and do nothing.
 *
 * Sharing them through Redis is what makes the demo cover the *whole* lifecycle rather than
 * stopping at payment. It is also what a multi-replica deployment needs anyway.
 *
 * The interface is async, unlike the in-memory one. That is unavoidable and honest: a shared
 * store involves I/O, and pretending otherwise would mean caching with no invalidation story.
 */

export interface AsyncSandboxSessionStore {
  create(scenarioId: ScenarioId, seed?: number): Promise<SandboxSession>;
  get(id: string): Promise<SandboxSession | undefined>;
  /** Persist mutations made by adapters — the log, the clock anchor, the counters. */
  save(session: SandboxSession): Promise<void>;
  advance(id: string, ms: number): Promise<SandboxSession | undefined>;
  reset(id: string): Promise<SandboxSession | undefined>;
  delete(id: string): Promise<void>;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisSandboxSessionStore implements AsyncSandboxSessionStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly prefix = 'sandbox:session:',
  ) {}

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async create(scenarioId: ScenarioId, seed = Math.floor(Math.random() * 2 ** 31)): Promise<SandboxSession> {
    // Validate up front so an unknown scenario fails at creation rather than on first use.
    getScenario(scenarioId);

    const session: SandboxSession = {
      id: `sbx_${uuid().replace(/-/g, '').slice(0, 16)}`,
      scenarioId,
      seed,
      createdAt: Date.now(),
      realStart: Date.now(),
      virtualOffsetMs: 0,
      purchasedAtVirtual: undefined,
      log: [],
      counters: {},
    };

    await this.save(session);
    return session;
  }

  async get(id: string): Promise<SandboxSession | undefined> {
    const raw = await this.redis.get(this.key(id));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as SandboxSession;
    } catch {
      // A corrupt session is a missing session; the caller falls back to production adapters.
      await this.delete(id);
      return undefined;
    }
  }

  async save(session: SandboxSession): Promise<void> {
    await this.redis.set(this.key(session.id), JSON.stringify(session), 'PX', this.ttlMs);
  }

  async advance(id: string, ms: number): Promise<SandboxSession | undefined> {
    const session = await this.get(id);
    if (!session) return undefined;
    session.virtualOffsetMs += Math.max(0, ms); // time does not run backwards, even in a demo
    await this.save(session);
    return session;
  }

  async reset(id: string): Promise<SandboxSession | undefined> {
    const session = await this.get(id);
    if (!session) return undefined;
    session.virtualOffsetMs = 0;
    session.purchasedAtVirtual = undefined;
    session.log.length = 0;
    for (const k of Object.keys(session.counters)) delete session.counters[k];
    await this.save(session);
    return session;
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }
}
