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
import { Public } from '../common/http.ts';
import { zodBody } from '../common/zod-pipe.ts';
import { SANDBOX_STORE } from '../tokens.ts';
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

@Public()
@Controller('v1/sandbox')
export class SandboxController {
  constructor(
    private readonly sandbox: SandboxService,
    private readonly orders: OrderService,
  ) {}

  @Get('scenarios')
  scenarios() {
    return this.sandbox.scenarios();
  }

  @Post('sessions')
  @HttpCode(201)
  create(@Body(zodBody(createSandboxSessionRequest)) body: { scenarioId: string; seed?: number }) {
    return this.sandbox.create(body.scenarioId, body.seed);
  }

  @Get('sessions/:id')
  get(@Param('id') id: string) {
    return this.sandbox.get(id);
  }

  /** Fast-forward the virtual clock. Nothing sleeps; legs already in the past become visible. */
  @Post('sessions/:id/advance')
  @HttpCode(200)
  advance(@Param('id') id: string, @Body(zodBody(advanceSandboxRequest)) body: { hours: number }) {
    return this.sandbox.advance(id, body.hours);
  }

  @Post('sessions/:id/reset')
  @HttpCode(200)
  reset(@Param('id') id: string) {
    return this.sandbox.reset(id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
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
  @Get('gateway')
  async gatewayPage(
    @Query('ref') ref: string,
    @Query('return') returnUrl: string,
    @Res() reply: FastifyReply,
  ) {
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
  @Post('gateway/settle')
  async gatewaySettle(
    @Body() body: { ref?: string; returnUrl?: string },
    @Res() reply: FastifyReply,
  ) {
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
