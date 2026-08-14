import { Controller, Get, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { healthcheck, type IdempotencyRepository } from '@xb/db';
import {
  CorrelationMiddleware,
  GlobalExceptionFilter,
  IdempotencyInterceptor,
  JwtAuthGuard,
  Public,
} from './common/http.ts';
import { InfrastructureModule } from './infrastructure.module.ts';
import { AuthModule, AuthService } from './modules/auth.module.ts';
import { CommerceModule } from './modules/commerce.module.ts';
import { AdminModule } from './modules/admin.module.ts';
import { SandboxModule } from './modules/sandbox.module.ts';
import { DevGatewayModule } from './modules/dev-gateway.module.ts';
import { IDEMPOTENCY_STORE } from './tokens.ts';

@Public()
@Controller()
export class HealthController {
  /** Liveness. Deliberately checks nothing — a dependency blip must not restart the process. */
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Readiness. Checks dependencies, so a load balancer stops sending traffic when they're down. */
  @Get('ready')
  async ready() {
    const database = await healthcheck().catch(() => false);
    return { status: database ? 'ready' : 'degraded', database };
  }
}

@Module({
  imports: [
    InfrastructureModule,
    AuthModule,
    CommerceModule,
    AdminModule,
    SandboxModule,
    // Registered unconditionally; the controller itself 404s outside development, so the
    // route's absence in production is enforced by one rule in one place rather than by
    // remembering to exclude a module here as well.
    DevGatewayModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global filter, guard and interceptor. Applied to every route without any controller
    // opting in — the only way to be certain none was forgotten.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    {
      provide: APP_GUARD,
      inject: [Reflector, AuthService],
      useFactory: (reflector: Reflector, auth: AuthService) => new JwtAuthGuard(reflector, auth),
    },
    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector, IDEMPOTENCY_STORE],
      useFactory: (reflector: Reflector, store: IdempotencyRepository) =>
        new IdempotencyInterceptor(reflector, store),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
