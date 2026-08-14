import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

/**
 * Development seed.
 *
 * Creates the operator accounts the back office needs to sign in. Nothing else is seeded:
 * customers, quotes and orders are all produced by walking the real flow, which is a better
 * test of the system than inserting rows that never passed through it.
 *
 * The password hashing here is plain SHA-256 to match the current AuthService. That is
 * adequate for local development and NOT adequate for production — see the note below.
 */

const OPERATORS = [
  { email: 'ops@example.ir', displayName: 'Ops Operator', role: 'ops', password: 'ops-dev-password' },
  {
    email: 'finance@example.ir',
    displayName: 'Finance Analyst',
    role: 'finance',
    password: 'finance-dev-password',
  },
  { email: 'admin@example.ir', displayName: 'Administrator', role: 'admin', password: 'admin-dev-password' },
];

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  if (process.env['NODE_ENV'] === 'production') {
    console.error('Refusing to seed a production database.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    for (const op of OPERATORS) {
      const hash = createHash('sha256').update(op.password).digest('hex');
      await sql`
        INSERT INTO "operator" (id, email, display_name, password_hash, role, active)
        VALUES (${randomUUID()}, ${op.email}, ${op.displayName}, ${hash}, ${op.role}, true)
        ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, role = ${op.role}
      `;
      console.log(`  operator ${op.email.padEnd(22)} role=${op.role}`);
    }

    console.log('\nSeeded. Back office sign-in:');
    for (const op of OPERATORS) console.log(`  ${op.email} / ${op.password}`);
    console.log(
      '\nNOTE: passwords are SHA-256 here to match the current AuthService. Before any\n' +
        'production use, switch both to argon2id or bcrypt — a fast hash over a human-chosen\n' +
        'password is brute-forceable offline if the table ever leaks.',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
