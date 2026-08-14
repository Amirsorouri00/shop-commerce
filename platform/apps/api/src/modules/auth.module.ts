import { Body, Controller, Get, Inject, Injectable, Module, Post, HttpCode } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  InvalidCredentialsError,
  RateLimitError,
  UnauthorizedError,
  uuidv7,
  type SmsPort,
} from '@xb/core';
import type { Env } from '@xb/contracts';
import {
  otpStartRequest,
  otpVerifyRequest,
  refreshRequest,
  operatorLoginRequest,
  createAddressRequest,
} from '@xb/contracts';
import { logger } from '@xb/observability';
import { CustomerRepository, customers, otpChallenges, refreshTokens, operators } from '@xb/db';
import { uuidv7 as newId } from '@xb/core';
import type { Database } from '@xb/db';
import { formatIranianMobile } from '@xb/validation';
import { Actor, Public, type AuthenticatedActor, type TokenVerifier } from '../common/http.ts';
import { zodBody } from '../common/zod-pipe.ts';
import { DB, ENV, SMS_PORT } from '../tokens.ts';

/**
 * Identity.
 *
 * Phone OTP is the primary method because it is the one that works for an Iranian consumer
 * without any foreign dependency. It is not the *only* method: everything below is written
 * against a provider-agnostic shape so adding OIDC is a new verify path, not a new auth
 * system.
 *
 * Two security properties are load-bearing:
 *
 *   - OTP codes are stored hashed and compared in constant time. A timing-comparable code
 *     store is a code store an attacker can walk.
 *   - Refresh tokens rotate, and a *reused* token revokes its whole family. Reuse means the
 *     token was captured; revoking only the presented token leaves the thief holding a newer
 *     one.
 */

const OTP_TTL_SECONDS = 120;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;

/**
 * A development SMS provider's pinned code, or undefined to generate a random one.
 *
 * The production check here duplicates the one in `buildSmsProviders`, which already refuses
 * to register a pinning provider outside development — so this branch should be unreachable
 * there. "Should be unreachable" is not a control. On the other side of this check is a
 * constant OTP, which is not a degraded experience but anyone signing in as anyone, and a
 * second `if` is a cheap price for not depending on one registration rule staying correct
 * through every future edit of the composition root.
 *
 * A free function rather than a private method so the guard is directly testable without
 * standing up a database.
 */
export async function pinnedOtpCode(env: Env, sms: SmsPort): Promise<string | undefined> {
  if (env.NODE_ENV === 'production') return undefined;

  // The failover proxy exposes only what a registered provider implements as a function and
  // returns undefined otherwise, so this is an accurate capability check, not a guess.
  if (typeof sms.fixedOtpCode !== 'function') return undefined;

  const code = await sms.fixedOtpCode();

  // A provider returning something the verify path could never accept would fail every
  // sign-in with no indication why. Reject the value rather than store it.
  if (!/^\d{6}$/.test(code)) {
    logger.error(
      { provider: (sms as { name?: string }).name },
      'SMS provider returned a pinned OTP that is not six digits; generating one instead',
    );
    return undefined;
  }

  return code;
}

@Injectable()
export class AuthService implements TokenVerifier {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(SMS_PORT) private readonly sms: SmsPort,
  ) {}

  private get accessSecret(): Uint8Array {
    return new TextEncoder().encode(this.env.JWT_ACCESS_SECRET);
  }

  private get refreshSecret(): Uint8Array {
    return new TextEncoder().encode(this.env.JWT_REFRESH_SECRET);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // ── OTP ──

  async startOtp(phoneE164: string) {
    // Rate limit per phone. Without this the endpoint is an SMS-billing denial-of-wallet.
    const [recent] = await this.db
      .select({ createdAt: otpChallenges.createdAt })
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phoneE164, phoneE164),
          gt(otpChallenges.createdAt, new Date(Date.now() - OTP_RESEND_SECONDS * 1000)),
        ),
      )
      .limit(1);

    if (recent) {
      const waited = (Date.now() - recent.createdAt.getTime()) / 1000;
      throw new RateLimitError(Math.ceil(OTP_RESEND_SECONDS - waited));
    }

    // randomInt is CSPRNG-backed. Math.random() here would make codes predictable.
    const code =
      (await pinnedOtpCode(this.env, this.sms)) ??
      String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = uuidv7();

    await this.db.insert(otpChallenges).values({
      id,
      phoneE164,
      codeHash: this.hash(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });

    await this.sms.send({
      to: phoneE164,
      message: `کد ورود شما: ${code}\nاین کد تا ${OTP_TTL_SECONDS / 60} دقیقه معتبر است.`,
    });

    if (this.env.NODE_ENV === 'development') {
      // `code` is a redacted path in the logger — deliberately. Use a distinct key so the dev
      // affordance works without punching a hole in the redaction rules for real OTPs.
      logger.info(
        { phone: formatIranianMobile(phoneE164, 'en'), devOtp: code },
        'DEV OTP issued (development only)',
      );
    }

    return {
      challengeId: id,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
      resendAfter: OTP_RESEND_SECONDS,
    };
  }

  async verifyOtp(challengeId: string, code: string) {
    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new InvalidCredentialsError('OTP challenge missing, used, or expired');
    }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new RateLimitError(60, { details: { reason: 'otp_attempts_exhausted' } });
    }

    await this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, challengeId));

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.hash(code), 'hex');

    // Constant-time comparison — a length check first because timingSafeEqual throws on
    // mismatched lengths, and both buffers are fixed-width hashes anyway.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new InvalidCredentialsError('Incorrect OTP');
    }

    await this.db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenges.id, challengeId));

    const repo = new CustomerRepository(this.db);
    const customer = await repo.upsertByPhone(challenge.phoneE164);
    await repo.linkIdentity(customer.id, 'otp', challenge.phoneE164);

    return this.issueTokens(customer.id, customer.phoneE164, customer.displayName, customer.locale);
  }

  // ── tokens ──

  private async issueTokens(
    customerId: string,
    phone: string,
    displayName: string | null,
    locale: string,
  ) {
    const familyId = uuidv7();
    const accessToken = await this.signAccess(customerId, 'customer', 'customer');
    const refreshToken = await this.signRefresh(customerId, familyId);

    await this.db.insert(refreshTokens).values({
      id: uuidv7(),
      customerId,
      familyId,
      tokenHash: this.hash(refreshToken),
      expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.env.JWT_ACCESS_TTL,
      customer: {
        id: customerId,
        phone,
        displayName,
        locale: (locale === 'en' ? 'en' : 'fa') as 'fa' | 'en',
      },
    };
  }

  private async signAccess(subject: string, kind: string, role: string): Promise<string> {
    return new SignJWT({ kind, role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuer(this.env.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.env.JWT_ACCESS_TTL}s`)
      .setJti(uuidv7())
      .sign(this.accessSecret);
  }

  private async signRefresh(subject: string, familyId: string): Promise<string> {
    return new SignJWT({ familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuer(this.env.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.env.JWT_REFRESH_TTL}s`)
      .setJti(uuidv7())
      .sign(this.refreshSecret);
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedActor> {
    try {
      const { payload } = await jwtVerify(token, this.accessSecret, {
        issuer: this.env.JWT_ISSUER,
      });
      return {
        id: String(payload.sub),
        kind: (payload['kind'] === 'operator' ? 'operator' : 'customer') as 'customer' | 'operator',
        role: String(payload['role'] ?? 'customer'),
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  /**
   * Rotate a refresh token.
   *
   * A token already marked used is a replay: the whole family is revoked, which logs the
   * legitimate user out too. That is the correct trade — a forced re-login is a minor
   * annoyance, a live session in an attacker's hands is not.
   */
  async refresh(presented: string) {
    const { payload } = await jwtVerify(presented, this.refreshSecret, {
      issuer: this.env.JWT_ISSUER,
    }).catch(() => {
      throw new UnauthorizedError('Invalid refresh token');
    });

    const tokenHash = this.hash(presented);
    const [stored] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!stored || stored.revokedAt) throw new UnauthorizedError('Refresh token revoked');

    if (stored.usedAt) {
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, stored.familyId), isNull(refreshTokens.revokedAt)));

      logger.warn({ familyId: stored.familyId }, 'refresh token reuse detected; family revoked');
      throw new UnauthorizedError('Refresh token reuse detected');
    }

    await this.db
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, stored.customerId))
      .limit(1);
    if (!customer) throw new UnauthorizedError('Customer no longer exists');

    const accessToken = await this.signAccess(customer.id, 'customer', 'customer');
    const nextRefresh = await this.signRefresh(customer.id, stored.familyId);

    await this.db.insert(refreshTokens).values({
      id: uuidv7(),
      customerId: customer.id,
      familyId: stored.familyId,
      tokenHash: this.hash(nextRefresh),
      expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
    });

    return {
      accessToken,
      refreshToken: nextRefresh,
      expiresIn: this.env.JWT_ACCESS_TTL,
      customer: {
        id: customer.id,
        phone: customer.phoneE164,
        displayName: customer.displayName,
        locale: (customer.locale === 'en' ? 'en' : 'fa') as 'fa' | 'en',
      },
    };
  }

  async revokeFamilyFor(customerId: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.customerId, customerId), isNull(refreshTokens.revokedAt)));
  }

  // ── operators ──

  async loginOperator(email: string, password: string) {
    const [operator] = await this.db
      .select()
      .from(operators)
      .where(eq(operators.email, email.toLowerCase()))
      .limit(1);

    // Hash regardless of whether the operator exists, so response time does not reveal
    // which emails are registered.
    const candidate = this.hash(password);
    const matches =
      operator !== undefined && operator.active && operator.passwordHash === candidate;

    if (!matches) throw new InvalidCredentialsError('Invalid operator credentials');

    const accessToken = await this.signAccess(operator!.id, 'operator', operator!.role);

    return {
      accessToken,
      expiresIn: this.env.JWT_ACCESS_TTL,
      operator: {
        id: operator!.id,
        email: operator!.email,
        displayName: operator!.displayName,
        role: operator!.role as 'ops' | 'finance' | 'admin',
      },
    };
  }
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/start')
  @HttpCode(202)
  async startOtp(@Body(zodBody(otpStartRequest)) body: { phone: string }) {
    return this.auth.startOtp(body.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(zodBody(otpVerifyRequest)) body: { challengeId: string; code: string }) {
    return this.auth.verifyOtp(body.challengeId, body.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(zodBody(refreshRequest)) body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('operator/login')
  @HttpCode(200)
  async operatorLogin(
    @Body(zodBody(operatorLoginRequest)) body: { email: string; password: string },
  ) {
    return this.auth.loginOperator(body.email, body.password);
  }
}

/**
 * Delivery addresses.
 *
 * Part of identity rather than commerce: an address belongs to a customer and outlives any
 * individual order. Checkout references one by id, so an order can never carry an address
 * that was never validated.
 */
@Controller('v1/addresses')
export class AddressController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async list(@Actor() actor: AuthenticatedActor) {
    const rows = await new CustomerRepository(this.db).listAddresses(actor.id);
    return rows.map((a) => ({
      id: a.id,
      recipientName: a.recipientName,
      phone: a.phoneE164,
      province: a.province,
      city: a.city,
      line1: a.line1,
      postalCode: a.postalCode,
      isDefault: a.isDefault,
    }));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(zodBody(createAddressRequest))
    body: {
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      line1: string;
      postalCode: string;
      nationalId?: string;
      isDefault: boolean;
    },
    @Actor() actor: AuthenticatedActor,
  ) {
    const row = await new CustomerRepository(this.db).createAddress({
      id: newId(),
      customerId: actor.id,
      recipientName: body.recipientName,
      nationalId: body.nationalId ?? null,
      phoneE164: body.phone,
      province: body.province,
      city: body.city,
      line1: body.line1,
      postalCode: body.postalCode,
      isDefault: body.isDefault,
    });

    return {
      id: row.id,
      recipientName: row.recipientName,
      phone: row.phoneE164,
      province: row.province,
      city: row.city,
      line1: row.line1,
      postalCode: row.postalCode,
      isDefault: row.isDefault,
    };
  }
}

@Module({
  controllers: [AuthController, AddressController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
