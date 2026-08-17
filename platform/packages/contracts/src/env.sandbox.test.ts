import { describe, it, expect, beforeEach } from 'vitest';
import { envSchema, isSandboxPermitted, loadEnv, resetEnv, type Env } from './env.ts';

/**
 * WP-01 regression tests — sandbox containment (G-01).
 *
 * Every case here fails against the previous schema, where `SANDBOX_ENABLED` was
 * `.optional().transform((v) => v !== 'false')`: unset produced `true`, and so did every
 * misspelling. The point of the fix is that "unset", "off" and "typo" stop being the same
 * answer, and that the answer they stop being is `enabled`.
 */

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  AMQP_URL: 'amqp://localhost:5672',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const parse = (extra: Record<string, string> = {}) => envSchema.safeParse({ ...base, ...extra });

describe('sandbox configuration fails closed', () => {
  beforeEach(() => resetEnv());

  it('defaults to disabled when SANDBOX_MODE is unset', () => {
    const result = parse();
    expect(result.success).toBe(true);
    expect(result.success && result.data.SANDBOX_MODE).toBe('disabled');
    expect(result.success && isSandboxPermitted(result.data)).toBe(false);
  });

  it('refuses to start on an unrecognised SANDBOX_MODE rather than falling back', () => {
    // The old transform silently mapped anything that was not the literal string 'false' to
    // enabled, so a typo enabled the sandbox. A boot failure is the only safe reading of a
    // value nobody can interpret.
    for (const bad of ['true', 'yes', 'on', '1', 'Enabled', '']) {
      expect(parse({ SANDBOX_MODE: bad }).success, `SANDBOX_MODE=${bad}`).toBe(false);
    }
  });

  it('enables only on the exact literal "enabled"', () => {
    const result = parse({ SANDBOX_MODE: 'enabled' });
    expect(result.success && isSandboxPermitted(result.data)).toBe(true);
  });

  it('treats an explicit "disabled" and an absent value identically', () => {
    const explicit = parse({ SANDBOX_MODE: 'disabled' });
    const absent = parse();
    expect(explicit.success && isSandboxPermitted(explicit.data)).toBe(false);
    expect(absent.success && isSandboxPermitted(absent.data)).toBe(false);
  });
});

describe('sandbox in production requires a second deliberate statement', () => {
  beforeEach(() => resetEnv());

  it('refuses to boot when sandbox is enabled in production without the policy flag', () => {
    const result = parse({ NODE_ENV: 'production', SANDBOX_MODE: 'enabled' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('SANDBOX_MODE'))).toBe(true);
    }
  });

  it('permits sandbox in production only when the policy flag is explicitly true', () => {
    const result = parse({
      NODE_ENV: 'production',
      SANDBOX_MODE: 'enabled',
      SANDBOX_ALLOW_IN_PRODUCTION: 'true',
    });
    expect(result.success).toBe(true);
    expect(result.success && isSandboxPermitted(result.data)).toBe(true);
  });

  it('rejects a non-boolean policy flag instead of coercing it', () => {
    for (const bad of ['yes', '1', 'TRUE', '']) {
      expect(
        parse({ NODE_ENV: 'production', SANDBOX_MODE: 'enabled', SANDBOX_ALLOW_IN_PRODUCTION: bad })
          .success,
        `SANDBOX_ALLOW_IN_PRODUCTION=${bad}`,
      ).toBe(false);
    }
  });

  it('leaves the policy flag inert outside production', () => {
    // The flag grants permission for production; it must not by itself turn the sandbox on.
    const result = parse({ SANDBOX_ALLOW_IN_PRODUCTION: 'true' });
    expect(result.success && result.data.SANDBOX_MODE).toBe('disabled');
    expect(result.success && isSandboxPermitted(result.data)).toBe(false);
  });

  it('does not permit sandbox in production when the mode itself is disabled', () => {
    const result = parse({
      NODE_ENV: 'production',
      SANDBOX_MODE: 'disabled',
      SANDBOX_ALLOW_IN_PRODUCTION: 'true',
    });
    expect(result.success && isSandboxPermitted(result.data)).toBe(false);
  });
});

describe('loadEnv surfaces the failure at boot', () => {
  beforeEach(() => resetEnv());

  it('throws rather than returning a degraded configuration', () => {
    expect(() => loadEnv({ ...base, SANDBOX_MODE: 'sortof' } as NodeJS.ProcessEnv)).toThrow(
      'Environment validation failed',
    );
  });
});

describe('isSandboxPermitted is total over the policy inputs', () => {
  // Enumerated rather than sampled: three environments x two modes x two flags is the whole
  // input space, and the containment claim is about all of it, not a representative case.
  const envs = ['development', 'test', 'production'] as const;
  const modes = ['disabled', 'enabled'] as const;
  const flags = [false, true] as const;

  it('permits sandbox in exactly the intended combinations', () => {
    const permitted: string[] = [];

    for (const NODE_ENV of envs) {
      for (const SANDBOX_MODE of modes) {
        for (const SANDBOX_ALLOW_IN_PRODUCTION of flags) {
          const env = { NODE_ENV, SANDBOX_MODE, SANDBOX_ALLOW_IN_PRODUCTION } as unknown as Env;
          if (isSandboxPermitted(env)) {
            permitted.push(`${NODE_ENV}/${SANDBOX_MODE}/${SANDBOX_ALLOW_IN_PRODUCTION}`);
          }
        }
      }
    }

    expect(permitted.sort()).toEqual(
      [
        'development/enabled/false',
        'development/enabled/true',
        'production/enabled/true',
        'test/enabled/false',
        'test/enabled/true',
      ].sort(),
    );
  });
});
