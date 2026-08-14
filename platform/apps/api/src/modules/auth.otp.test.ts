import { describe, expect, it } from 'vitest';
import type { Env } from '@xb/contracts';
import type { SmsPort } from '@xb/core';
import { buildSmsProviders } from '../composition/adapters.ts';
import { pinnedOtpCode } from './auth.module.ts';

/**
 * The pinned-OTP guards.
 *
 * A constant verification code is a complete authentication bypass, so the thing under test
 * is not "does 123456 work" — it is that the two independent guards each hold on their own.
 * Both are exercised here precisely because either one alone would be sufficient in the
 * current wiring, and a test that only covered their combination would pass while one of
 * them silently rotted.
 */

const env = (over: Partial<Env> = {}): Env => ({ NODE_ENV: 'development', ...over }) as Env;

const noPin: SmsPort = { async send() { return { ok: true, providerRef: 'x' }; } };

const pinning = (code: string): SmsPort => ({
  async send() { return { ok: true, providerRef: 'x' }; },
  fixedOtpCode: () => code,
});

describe('pinnedOtpCode — the consumption guard', () => {
  it('returns the provider code in development', async () => {
    expect(await pinnedOtpCode(env(), pinning('123456'))).toBe('123456');
  });

  it('refuses a pinned code in production even when the provider offers one', async () => {
    // The bypass this whole feature must never become.
    expect(await pinnedOtpCode(env({ NODE_ENV: 'production' }), pinning('123456'))).toBeUndefined();
  });

  it('returns undefined when the provider does not pin, so a random code is generated', async () => {
    expect(await pinnedOtpCode(env(), noPin)).toBeUndefined();
  });

  it('treats a non-six-digit code as absent rather than storing an unusable one', async () => {
    expect(await pinnedOtpCode(env(), pinning('12345'))).toBeUndefined();
    expect(await pinnedOtpCode(env(), pinning('abcdef'))).toBeUndefined();
    expect(await pinnedOtpCode(env(), pinning(''))).toBeUndefined();
  });

  it('awaits a provider that resolves its code asynchronously', async () => {
    const async: SmsPort = {
      async send() { return { ok: true, providerRef: 'x' }; },
      fixedOtpCode: async () => '123456',
    };
    expect(await pinnedOtpCode(env(), async)).toBe('123456');
  });
});

describe('buildSmsProviders — the registration guard', () => {
  const withProviders = (providers: string[], nodeEnv: Env['NODE_ENV'] = 'development'): Env =>
    ({ NODE_ENV: nodeEnv, SMS_PROVIDERS: providers }) as Env;

  it('registers the fake provider in development, pinned to 123456', async () => {
    const built = buildSmsProviders(withProviders(['fake']));
    expect(built.map((p) => p.name)).toEqual(['fake-sms']);
    expect(await built[0]!.adapter.fixedOtpCode!()).toBe('123456');
  });

  it('refuses to register the fake provider in production', () => {
    expect(buildSmsProviders(withProviders(['fake'], 'production'))).toEqual([]);
  });

  it('refuses to register the stub in production', () => {
    expect(buildSmsProviders(withProviders(['stub'], 'production'))).toEqual([]);
  });

  it('registers the stub without a pinned code, so codes stay random', () => {
    const built = buildSmsProviders(withProviders(['stub']));
    expect(built.map((p) => p.name)).toEqual(['stub-sms']);
    expect(built[0]!.adapter.fixedOtpCode).toBeUndefined();
  });

  it('prefers the fake provider over the stub when both are configured', () => {
    const built = buildSmsProviders(withProviders(['fake', 'stub']));
    const fake = built.find((p) => p.name === 'fake-sms');
    const stub = built.find((p) => p.name === 'stub-sms');
    expect(fake!.priority).toBeLessThan(stub!.priority);
  });

  it('ignores an unknown provider name rather than failing to boot', () => {
    expect(buildSmsProviders(withProviders(['nope', 'fake'])).map((p) => p.name)).toEqual([
      'fake-sms',
    ]);
  });

  it('yields nothing when no provider is configured', () => {
    expect(buildSmsProviders(withProviders([]))).toEqual([]);
  });
});
