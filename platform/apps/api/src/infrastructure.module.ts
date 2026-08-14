import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { loadEnv, type Env } from '@xb/contracts';
import { createDatabase, IdempotencyRepository, UnitOfWork, type Database } from '@xb/db';
import { RedisSandboxSessionStore } from '@xb/sandbox';
import { buildAdapters, createRedis, type AdapterSet } from './composition/adapters.ts';
import { routeByContext } from './composition/sandbox-routing.ts';
import {
  ADAPTERS,
  CARRIER_PORT,
  CUSTOMS_PORT,
  DB,
  ENV,
  FX_PORT,
  IDEMPOTENCY_STORE,
  PAYMENT_PORT,
  PROCUREMENT_PORT,
  REDIS,
  SANDBOX_STORE,
  SMS_PORT,
  STORAGE_PORT,
  STORE_PORT,
  UNIT_OF_WORK,
} from './tokens.ts';

/**
 * Infrastructure — the runtime half of the composition root.
 *
 * `@Global()` because Nest modules are encapsulated by default, and without it every feature
 * module would have to import this one to reach the database or a port. That import list is
 * pure ceremony: these bindings are genuinely process-wide, there is exactly one of each, and
 * making each module restate that fact adds no safety.
 *
 * What is *not* global is any domain service. Those stay inside their own modules, so the
 * boundaries that actually matter are still enforced.
 *
 * Every port is bound here and nowhere else. A service injects `FX_PORT` and has no way to
 * discover which adapter answered — which is the property that lets a gated dependency go
 * live without touching a single service.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },

    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): Database =>
        createDatabase({
          url: env.DATABASE_URL,
          poolMax: env.DATABASE_POOL_MAX,
          debug: false,
        }),
    },

    { provide: REDIS, inject: [ENV], useFactory: (env: Env) => createRedis(env) },

    { provide: UNIT_OF_WORK, inject: [DB], useFactory: (db: Database) => new UnitOfWork(db) },

    // Redis rather than memory: the worker is a separate process and must see the same
    // session, or a sandbox order stalls the moment it leaves the API.
    {
      provide: SANDBOX_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisSandboxSessionStore(redis),
    },

    {
      provide: ADAPTERS,
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) => buildAdapters({ env, redis }),
    },

    // Ports resolve from the single adapter set, so the proxy chain is constructed once.
    //
    // The five gated ports are wrapped in the context router: a request carrying
    // X-Sandbox-Session reaches simulated adapters, everything else reaches production ones,
    // and no service can tell the difference. See composition/sandbox-routing.ts.
    {
      provide: STORE_PORT,
      inject: [ADAPTERS, SANDBOX_STORE],
      useFactory: (a: AdapterSet, s: RedisSandboxSessionStore) => routeByContext('store', a, s),
    },
    {
      provide: FX_PORT,
      inject: [ADAPTERS, SANDBOX_STORE],
      useFactory: (a: AdapterSet, s: RedisSandboxSessionStore) => routeByContext('fx', a, s),
    },
    {
      provide: PAYMENT_PORT,
      inject: [ADAPTERS, SANDBOX_STORE],
      useFactory: (a: AdapterSet, s: RedisSandboxSessionStore) => routeByContext('payment', a, s),
    },
    {
      provide: PROCUREMENT_PORT,
      inject: [ADAPTERS, SANDBOX_STORE],
      useFactory: (a: AdapterSet, s: RedisSandboxSessionStore) =>
        routeByContext('procurement', a, s),
    },
    {
      provide: CARRIER_PORT,
      inject: [ADAPTERS, SANDBOX_STORE],
      useFactory: (a: AdapterSet, s: RedisSandboxSessionStore) => routeByContext('carrier', a, s),
    },
    { provide: CUSTOMS_PORT, inject: [ADAPTERS], useFactory: (a: AdapterSet) => a.customs },
    { provide: SMS_PORT, inject: [ADAPTERS], useFactory: (a: AdapterSet) => a.sms },
    { provide: STORAGE_PORT, inject: [ADAPTERS], useFactory: (a: AdapterSet) => a.storage },

    {
      provide: IDEMPOTENCY_STORE,
      inject: [DB],
      useFactory: (db: Database) => new IdempotencyRepository(db),
    },
  ],
  exports: [
    ENV,
    DB,
    REDIS,
    UNIT_OF_WORK,
    ADAPTERS,
    STORE_PORT,
    FX_PORT,
    PAYMENT_PORT,
    PROCUREMENT_PORT,
    CARRIER_PORT,
    CUSTOMS_PORT,
    SMS_PORT,
    STORAGE_PORT,
    SANDBOX_STORE,
    IDEMPOTENCY_STORE,
  ],
})
export class InfrastructureModule {}
