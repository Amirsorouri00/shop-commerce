import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '@xb/observability';
import { schema } from './schema.ts';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbOptions {
  readonly url: string;
  readonly poolMax?: number;
  readonly debug?: boolean;
}

let sqlClient: ReturnType<typeof postgres> | undefined;
let db: Database | undefined;

export function createDatabase(options: DbOptions): Database {
  sqlClient = postgres(options.url, {
    max: options.poolMax ?? 20,
    // Prepared statements are disabled because a connection pooler in transaction mode
    // (PgBouncer, and most managed Postgres front ends) cannot route them correctly.
    // Turning this off now avoids a failure that only appears once a pooler is introduced.
    prepare: false,
    onnotice: (n) => logger.debug({ notice: n }, 'postgres notice'),
    transform: { undefined: null },
  });

  db = drizzle(sqlClient, { schema, logger: options.debug === true });
  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialised — call createDatabase() at startup');
  return db;
}

export async function closeDatabase(): Promise<void> {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = undefined;
  db = undefined;
}

export async function healthcheck(database: Database = getDatabase()): Promise<boolean> {
  try {
    await database.execute('select 1');
    return true;
  } catch (e) {
    logger.error({ err: e }, 'database healthcheck failed');
    return false;
  }
}
