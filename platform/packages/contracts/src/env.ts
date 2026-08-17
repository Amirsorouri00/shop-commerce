import { z } from 'zod';

/**
 * Environment validation.
 *
 * Parsed once at boot, and the process refuses to start on anything missing or malformed.
 * The alternative — reading `process.env` where it is needed — turns a typo in a deployment
 * config into a runtime failure hours later, usually inside a payment path.
 */

const csv = (fallback: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v && v.trim().length > 0 ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback,
    );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_CORS_ORIGINS: csv(['http://localhost:3000', 'http://localhost:3001']),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),

  REDIS_URL: z.string().url(),
  AMQP_URL: z.string().url(),
  AMQP_PREFETCH: z.coerce.number().int().min(1).max(1000).default(16),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_PACKAGES: z.string().default('xb-packages'),
  S3_BUCKET_DOCUMENTS: z.string().default('xb-documents'),

  // Minimum length is a real control, not decoration: a short HMAC secret is brute-forceable
  // and these sign the tokens that authorise everything.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().default(2_592_000),
  JWT_ISSUER: z.string().default('xb-platform'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('xb-api'),

  PAYMENT_PROVIDERS: csv(['stub']),
  /**
   * `fake` pins the OTP to a constant so sign-in during a demo or a browser test does not
   * require reading it out of a log. It is refused in production, where the fallback is a
   * real vendor — see `buildSmsProviders`.
   */
  SMS_PROVIDERS: csv(['fake']),
  FX_PROVIDERS: csv(['stub']),
  STORE_PROVIDERS: csv(['stub']),
  CARRIER_PROVIDERS: csv(['stub']),

  /**
   * Sandbox enablement. Fails closed.
   *
   * A strict enum with an explicit default rather than a coerced boolean. The previous
   * `.optional().transform((v) => v !== 'false')` meant an *unset* variable evaluated to
   * `true` — the sandbox enabled itself wherever nobody had said otherwise, under a comment
   * claiming it was off in production. An enum makes "unset" and "misspelled" two different
   * outcomes: unset is `disabled`, and anything unrecognised is a boot failure rather than a
   * silent fallback in either direction.
   */
  SANDBOX_MODE: z.enum(['disabled', 'enabled']).default('disabled'),

  /**
   * Permission for sandbox to run in production, which is a separate question from whether
   * sandbox is on. One flag cannot distinguish "this is a demo environment and we meant it"
   * from "nobody configured this" — and it is the second case that has to be impossible.
   */
  SANDBOX_ALLOW_IN_PRODUCTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  ZARINPAL_MERCHANT_ID: z.string().optional(),
  IDPAY_API_KEY: z.string().optional(),
  KAVENEGAR_API_KEY: z.string().optional(),
  SMSIR_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
})
  /**
   * Sandbox in production requires two deliberate statements, not one.
   *
   * Enforced here rather than at the call site so it is a boot failure: a warning in a log
   * nobody reads is how the previous fail-open default survived this long.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SANDBOX_MODE === 'enabled' && !env.SANDBOX_ALLOW_IN_PRODUCTION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_MODE'],
        message:
          'refusing to enable sandbox in production: set SANDBOX_ALLOW_IN_PRODUCTION=true only if a production demo environment is genuinely intended',
      });
    }
  });

/**
 * Is the sandbox surface permitted to exist in this process?
 *
 * One resolved policy, consulted by both enforcement points — the composition root, which
 * decides whether the routes exist at all, and the controller, which 404s if they somehow do.
 * Two enforcement points reading one rule, rather than two rules that can disagree.
 */
export function isSandboxPermitted(env: Env): boolean {
  if (env.SANDBOX_MODE !== 'enabled') return false;
  // `=== true` rather than truthiness: the flag is a boolean only after the schema's transform
  // has run, and an unparsed value would arrive as the string 'false', which is truthy.
  return env.NODE_ENV !== 'production' || env.SANDBOX_ALLOW_IN_PRODUCTION === true;
}

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(source);

  if (!result.success) {
    // Deliberately not the bilingual validation error: this is an operator-facing failure at
    // boot, and it must be readable in a container log without any of our machinery running.
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    throw new Error('Environment validation failed');
  }

  cached = result.data;
  return cached;
}

/** Test helper — clears the memoised environment. */
export function resetEnv(): void {
  cached = undefined;
}
