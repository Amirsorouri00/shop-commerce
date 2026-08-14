import { Body, Controller, Get, Inject, Module, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { NotFoundError } from '@xb/core';
import type { Env } from '@xb/contracts';
import { logger } from '@xb/observability';
import { Public } from '../common/http.ts';
import { ENV } from '../tokens.ts';
import { CommerceModule, OrderService } from './commerce.module.ts';
import { renderSimulatedGatewayPage } from './gateway-page.ts';

/**
 * The development payment gateway.
 *
 * The sandbox has had one of these all along, but only for orders created inside a sandbox
 * session. An order placed through the ordinary flow reaches `StubPaymentAdapter`, which
 * returned a redirect straight back to the application — so the customer came back from a
 * gateway that had never existed, nothing settled, and the order stayed in AWAITING_PAYMENT
 * permanently. There was no way to pay for an order outside a demo.
 *
 * This closes that: the stub now redirects here, and this page drives the same
 * `OrderService.settlePayment` a real gateway webhook drives. The ledger posting, the state
 * transition to PAID and the outbox event are all the production path — only the decision to
 * settle is a button instead of a bank.
 *
 * It is refused outside development, where the equivalent must be a real gateway.
 */
@Public()
@Controller('v1/dev/gateway')
export class DevGatewayController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly orders: OrderService,
  ) {}

  /**
   * A 404 rather than a 403.
   *
   * In production this route should not appear to exist at all: a 403 confirms there is a
   * development payment gateway on this host and invites someone to go looking for a way in.
   */
  private assertEnabled(): void {
    if (this.env.NODE_ENV === 'production') {
      throw new NotFoundError('Route', 'v1/dev/gateway');
    }
  }

  @Get()
  async page(
    @Query('ref') ref: string,
    @Query('return') returnUrl: string,
    @Query('amount') amountLabel: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    this.assertEnabled();

    void reply.type('text/html; charset=utf-8').send(
      renderSimulatedGatewayPage({
        ref: ref ?? '',
        returnUrl: returnUrl ?? '/',
        settleAction: '/v1/dev/gateway/settle',
        amountLabel,
        modeLabel: 'حالت توسعه',
      }),
    );
  }

  /**
   * Settlement.
   *
   * Only ever settles the `stub` provider. The provider name is fixed here rather than taken
   * from the request precisely because this endpoint is unauthenticated — a caller who could
   * name the provider could aim this at a real gateway's payment records.
   */
  @Post('settle')
  async settle(@Body() body: { ref?: string; returnUrl?: string }, @Res() reply: FastifyReply) {
    this.assertEnabled();

    const ref = body.ref ?? '';
    const returnUrl = body.returnUrl ?? '/';

    try {
      await this.orders.settlePayment('stub', ref);
      logger.info({ providerRef: ref }, 'development gateway settled payment');
    } catch (e) {
      // Mirrors the sandbox gateway: the customer is returned either way and the application
      // polls for the real state, because a gateway that strands the customer on an error
      // page is worse than one that returns them to an order that has not moved.
      logger.error({ providerRef: ref, err: e }, 'development gateway settlement failed');
    }

    void reply.redirect(
      `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`,
      302,
    );
  }
}

@Module({
  imports: [CommerceModule],
  controllers: [DevGatewayController],
})
export class DevGatewayModule {}
