import type { Config } from 'drizzle-kit';

/**
 * Used for `drizzle-kit generate` when inspecting drift between the TS schema and the
 * database. Migrations themselves are hand-written SQL applied by `src/migrate.ts` — see
 * the comment there for why.
 */
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://xb:xb@localhost:5432/xb',
  },
} satisfies Config;
