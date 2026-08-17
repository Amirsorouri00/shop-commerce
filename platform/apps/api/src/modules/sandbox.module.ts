import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { NotFoundError } from '@xb/core';
import {
  advanceSandboxRequest,
  createSandboxSessionRequest,
  isSandboxPermitted,
  type Env,
  type SandboxScenarioDto,
  type SandboxSessionDto,
} from '@xb/contracts';
import { logger } from '@xb/observability';
import {
  buildContext,
  listScenarios,
  SCENARIOS,
  type AsyncSandboxSessionStore,
  type ScenarioId,
} from '@xb/sandbox';
import { Public, Roles } from '../common/http.ts';
import { zodBody } from '../common/zod-pipe.ts';
import { ENV, SANDBOX_STORE } from '../tokens.ts';
import { CommerceModule, OrderService } from './commerce.module.ts';
import { renderSimulatedGatewayPage } from './gateway-page.ts';

/**
 * Sandbox control surface.
 *
 * The demo needs to *drive* the simulation, not just observe it — pick a scenario, advance
 * the clock, watch the exception fire, reset and try another.
 *
 * Session id travels in `X-Sandbox-Session`, which the context router reads to swap the live
 * adapter set. A request without that header uses the production adapters, so the sandbox
 * cannot be entered by accident.
 */

@Injectable()
export class SandboxService {
  constructor(@Inject(SANDBOX_STORE) private readonly store: AsyncSandboxSessionStore) {}

  scenarios(): SandboxScenarioDto[] {
    return listScenarios().map((s) => ({
      id: s.id,
      stage: s.stage,
      title: s.title,
      description: s.description,
    }));
  }

  async create(scenarioId: string, seed?: number): Promise<SandboxSessionDto> {
    if (!(scenarioId in SCENARIOS)) throw new NotFoundError('Scenario', scenarioId);
    const session = await this.store.create(scenarioId as ScenarioId, seed);
    return this.toDto(session.id);
  }

  async get(id: string): Promise<SandboxSessionDto> {
    return this.toDto(id);
  }

  async advance(id: string, hours: number): Promise<SandboxSessionDto> {
    if (!(await this.store.advance(id, hours * 3_600_000))) {
      throw new NotFoundError('Sandbox session', id);
    }
    return this.toDto(id);
  }

  async reset(id: string): Promise<SandboxSessionDto> {
    if (!(await this.store.reset(id))) throw new NotFoundError('Sandbox session', id);
    return this.toDto(id);
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(id);
  }

  private async toDto(id: string): Promise<SandboxSessionDto> {
    const session = await this.store.get(id);
    if (!session) throw new NotFoundError('Sandbox session', id);

    const ctx = buildContext(session);

    return {
      id: session.id,
      scenarioId: session.scenarioId,
      seed: session.seed,
      virtualOffsetMs: session.virtualOffsetMs,
      virtualNow: ctx.clock.nowIso(),
      hoursSincePurchase: ctx.clock.hoursSincePurchase() ?? null,
      log: session.log.map((e) => ({
        at: e.at,
        stage: e.stage,
        message: e.message,
        ...(e.detail ? { detail: e.detail } : {}),
      })),
      counters: { ...session.counters },
    };
  }
}

/**
 * Sandbox control plane.
 *
 * Two separate protections, because two different things are exposed here.
 *
 * **Existence** — every route 404s unless the sandbox is permitted in this environment. A 404
 * rather than a 403 for the same reason the development gateway uses one: a 403 confirms the
 * surface is there and invites someone to look for a way in. The policy itself lives in
 * `isSandboxPermitted`, so the composition root and this controller cannot disagree about it.
 *
 * **Authority** — the control-plane routes require an authenticated operator. They create
 * sessions, move the virtual clock and delete state; none of that is anonymous work. This is a
 * deliberately coarse check: *any* operator, not a scoped permission, because the permission
 * model does not exist yet (WP-06). Waiting for it would mean leaving these routes open for
 * the length of that chain, which is the wrong trade.
 *
 * The two simulated-gateway routes are exempt from the operator check and marked `@Public()`
 * individually — a customer's browser is redirected to them mid-checkout and carries no bearer
 * token. They keep the environment gate. Making them *verified* rather than merely gated is
 * WP-02's structural fix, not something to improvise here.
 */
@Roles('ops', 'finance', 'admin')
@Controller('v1/sandbox')
export class SandboxController {
  constructor(
    private readonly sandbox: SandboxService,
    private readonly orders: OrderService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Existence gate.
   *
   * Called by every handler rather than applied as a guard so that it cannot be forgotten by a
   * route added later without one — the failure mode this package exists to remove.
   */
  private assertSandboxPermitted(): void {
    if (!isSandboxPermitted(this.env)) {
      throw new NotFoundError('Route', 'v1/sandbox');
    }
  }

  @Get('scenarios')
  scenarios() {
    this.assertSandboxPermitted();
    return this.sandbox.scenarios();
  }

  @Post('sessions')
  @HttpCode(201)
  create(@Body(zodBody(createSandboxSessionRequest)) body: { scenarioId: string; seed?: number }) {
    this.assertSandboxPermitted();
    return this.sandbox.create(body.scenarioId, body.seed);
  }

  @Get('sessions/:id')
  get(@Param('id') id: string) {
    this.assertSandboxPermitted();
    return this.sandbox.get(id);
  }

  /** Fast-forward the virtual clock. Nothing sleeps; legs already in the past become visible. */
  @Post('sessions/:id/advance')
  @HttpCode(200)
  advance(@Param('id') id: string, @Body(zodBody(advanceSandboxRequest)) body: { hours: number }) {
    this.assertSandboxPermitted();
    return this.sandbox.advance(id, body.hours);
  }

  @Post('sessions/:id/reset')
  @HttpCode(200)
  reset(@Param('id') id: string) {
    this.assertSandboxPermitted();
    return this.sandbox.reset(id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    this.assertSandboxPermitted();
    await this.sandbox.remove(id);
  }

  /**
   * The simulated payment gateway.
   *
   * A real IRR gateway hosts its own page, takes the customer's card, then notifies us by
   * signed webhook. This stands in for that: a page the customer is genuinely redirected to,
   * with a real choice, which then drives the same `settlePayment` path a webhook would.
   *
   * Without it the demo stops dead at checkout — the redirect would return to the app with
   * nothing having settled, and the order would sit in AWAITING_PAYMENT forever.
   */
  @Public()
  @Get('gateway')
  async gatewayPage(
    @Query('ref') ref: string,
    @Query('return') returnUrl: string,
    @Res() reply: FastifyReply,
  ) {
    this.assertSandboxPermitted();

    void reply.type('text/html; charset=utf-8').send(
      renderSimulatedGatewayPage({
        ref: ref ?? '',
        returnUrl: returnUrl ?? '/',
        settleAction: '/v1/sandbox/gateway/settle',
        modeLabel: 'شبیه‌سازی',
      }),
    );
  }

  /**
   * Settlement callback.
   *
   * Drives exactly the same `OrderService.settlePayment` a real gateway webhook does, so the
   * ledger posting, the state transition and the outbox event are all the production path.
   * Signature verification is skipped because the caller *is* this API — there is no third
   * party to authenticate.
   */
  @Public()
  @Post('gateway/settle')
  async gatewaySettle(
    @Body() body: { ref?: string; returnUrl?: string },
    @Res() reply: FastifyReply,
  ) {
    this.assertSandboxPermitted();

    const ref = body.ref ?? '';
    const returnUrl = body.returnUrl ?? '/';

    try {
      await this.orders.settlePayment('sandbox', ref);
      logger.info({ providerRef: ref }, 'sandbox gateway settled payment');
    } catch (e) {
      logger.error({ providerRef: ref, err: e }, 'sandbox gateway settlement failed');
    }

    void reply.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`, 302);
  }
}

@Module({
  // CommerceModule provides OrderService: the simulated gateway drives the same
  // settlePayment path a real webhook does, rather than a parallel one.
  imports: [CommerceModule],
  controllers: [SandboxController],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
