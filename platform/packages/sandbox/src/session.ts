import { uuid } from '@xb/core';
import { getScenario, type ScenarioDefinition, type ScenarioId } from './scenario.ts';

/**
 * Sandbox sessions.
 *
 * Every sandbox interaction is scoped to a session, identified by the `X-Sandbox-Session`
 * header. Two properties follow from that and both matter:
 *
 *   - **Isolation.** Two people demoing at once, or a demo running beside an automated test,
 *     do not disturb each other. Without session scoping, "advance the clock" is a global
 *     action and every concurrent demo jumps forward.
 *
 *   - **Reproducibility.** Each session carries a seed. All sandbox randomness comes from
 *     that seed, so the same scenario with the same seed produces byte-identical output —
 *     which is what makes sandbox runs usable as regression tests rather than just demos.
 *
 * The virtual clock is what lets a five-day delivery be walked through in a meeting. Nothing
 * sleeps; `advance()` moves the clock and the carrier adapter reports whichever legs are now
 * in the past.
 */

export interface SandboxSession {
  readonly id: string;
  readonly scenarioId: ScenarioId;
  readonly seed: number;
  readonly createdAt: number;
  /** Real epoch ms at which the virtual clock was anchored. */
  readonly realStart: number;
  /** Virtual ms elapsed beyond real time — moved by `advance()`. */
  virtualOffsetMs: number;
  /** Set when the order is purchased, so shipment legs can be scheduled relative to it. */
  purchasedAtVirtual: number | undefined;
  /** Human-readable trace of what the sandbox did, surfaced in the demo UI. */
  readonly log: SandboxLogEntry[];
  /** Scenario-scoped counters, e.g. how many times payment has been attempted. */
  readonly counters: Record<string, number>;
}

export interface SandboxLogEntry {
  readonly at: string;
  readonly stage: string;
  readonly message: { readonly en: string; readonly fa: string };
  readonly detail?: Record<string, unknown>;
}

export interface SandboxSessionStore {
  create(scenarioId: ScenarioId, seed?: number): SandboxSession;
  get(id: string): SandboxSession | undefined;
  advance(id: string, ms: number): SandboxSession | undefined;
  reset(id: string): SandboxSession | undefined;
  delete(id: string): void;
  list(): SandboxSession[];
}

/**
 * In-memory session store.
 *
 * Deliberately in-memory: sandbox state is ephemeral by definition, and persisting it would
 * mean sandbox data sharing a lifecycle with real orders. Sessions expire on a sweep so a
 * long-running process does not accumulate abandoned demos.
 */
export class MemorySandboxSessionStore implements SandboxSessionStore {
  private readonly sessions = new Map<string, SandboxSession>();

  constructor(private readonly ttlMs = 6 * 60 * 60 * 1000) {}

  create(scenarioId: ScenarioId, seed = Math.floor(Math.random() * 2 ** 31)): SandboxSession {
    this.sweep();

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

    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): SandboxSession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (Date.now() - s.createdAt > this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  advance(id: string, ms: number): SandboxSession | undefined {
    const s = this.get(id);
    if (!s) return undefined;
    s.virtualOffsetMs += Math.max(0, ms); // time does not run backwards, even in a demo
    return s;
  }

  reset(id: string): SandboxSession | undefined {
    const s = this.get(id);
    if (!s) return undefined;
    s.virtualOffsetMs = 0;
    s.purchasedAtVirtual = undefined;
    s.log.length = 0;
    for (const k of Object.keys(s.counters)) delete s.counters[k];
    return s;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  list(): SandboxSession[] {
    this.sweep();
    return [...this.sessions.values()];
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, s] of this.sessions) {
      if (s.createdAt < cutoff) this.sessions.delete(id);
    }
  }
}

// ─────────────────────────── virtual clock ───────────────────────────

export class VirtualClock {
  constructor(private readonly session: SandboxSession) {}

  /** Current virtual time: real elapsed time plus whatever the demo fast-forwarded. */
  now(): number {
    return Date.now() + this.session.virtualOffsetMs;
  }

  nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Virtual hours since the order was purchased, or undefined if it has not been. */
  hoursSincePurchase(): number | undefined {
    if (this.session.purchasedAtVirtual === undefined) return undefined;
    return (this.now() - this.session.purchasedAtVirtual) / 3_600_000;
  }

  markPurchased(): void {
    this.session.purchasedAtVirtual = this.now();
  }
}

// ─────────────────────────── seeded randomness ───────────────────────────

/**
 * mulberry32 — a small, fast, well-distributed seeded PRNG.
 *
 * `Math.random()` cannot be seeded, which would make sandbox runs unreproducible and
 * therefore useless as tests. This is not cryptographic and must never be used for anything
 * outside the sandbox.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SandboxContext {
  readonly session: SandboxSession;
  readonly scenario: ScenarioDefinition;
  readonly clock: VirtualClock;
  readonly random: () => number;
}

export function buildContext(session: SandboxSession): SandboxContext {
  return {
    session,
    scenario: getScenario(session.scenarioId),
    clock: new VirtualClock(session),
    random: seededRandom(session.seed),
  };
}

export function logSandbox(
  ctx: SandboxContext,
  stage: string,
  message: { en: string; fa: string },
  detail?: Record<string, unknown>,
): void {
  ctx.session.log.push({
    at: ctx.clock.nowIso(),
    stage,
    message,
    ...(detail ? { detail } : {}),
  });
}

export function bump(ctx: SandboxContext, counter: string): number {
  ctx.session.counters[counter] = (ctx.session.counters[counter] ?? 0) + 1;
  return ctx.session.counters[counter];
}
