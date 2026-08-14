import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

/**
 * Plain-SQL migration runner.
 *
 * Deliberately not Drizzle's generated-migration flow. This schema has constraint triggers
 * and partial indexes that a schema-diff generator cannot express, and for a ledger the
 * migration is the artefact you actually want reviewed — so the SQL is written by hand and
 * applied verbatim.
 *
 * Each file runs once, inside a transaction, recorded in `_migration`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "_migration" (
        "name" text PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM "_migration"`).map((r) => r.name),
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const contents = await readFile(join(migrationsDir, file), 'utf8');
      process.stdout.write(`applying ${file} ... `);

      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`INSERT INTO "_migration" (name) VALUES (${file})`;
      });

      console.log('ok');
      count++;
    }

    console.log(count === 0 ? 'database already up to date' : `applied ${count} migration(s)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('migration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
