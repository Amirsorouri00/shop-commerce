import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadEnv, isSandboxPermitted } from '@xb/contracts';
import { logger } from '@xb/observability';
import { closeDatabase } from '@xb/db';
import { AppModule } from './app.module.ts';

/**
 * API entry point.
 *
 * Fastify rather than Express: this process is mostly JSON serialisation and I/O
 * orchestration, which is precisely where Fastify's advantage shows.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Trust the proxy so client IPs are correct behind a load balancer — rate limiting by
      // the balancer's IP would throttle every user as if they were one.
      trustProxy: true,
      bodyLimit: 2 * 1024 * 1024,
      genReqId: () => crypto.randomUUID(),
    }),
    { bufferLogs: true },
  );

  /*
   * Treat an empty JSON body as `{}` rather than a 400.
   *
   * Several endpoints are POSTs that take no payload. A client that sets
   * `content-type: application/json` and sends nothing is technically malformed, but it is
   * also extremely common — every fetch wrapper that sets the header once for all requests
   * does it. Rejecting those is a brittleness we gain nothing from, and the failure it
   * produces is opaque at the call site.
   *
   * Bodies that are non-empty and genuinely invalid still fail, so this loosens exactly one
   * case and nothing else.
   *
   * Ordering matters and is the reason for the explicit `init()`. Nest registers its own
   * `application/json` parser during initialisation, and Fastify rejects a duplicate content
   * type outright — registering ours first makes Nest's registration throw at boot. So:
   * initialise, remove the parser Nest installed, install ours in its place. Removing only
   * the JSON parser leaves the urlencoded one intact, which the simulated payment gateway
   * needs — its settle step is a real HTML form POST.
   */
  await app.init();

  const fastify = app.getHttpAdapter().getInstance();
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 },
    (_req: unknown, body: string, done: (err: Error | null, result?: unknown) => void) => {
      if (body === undefined || body === null || body.trim().length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err);
      }
    },
  );

  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    allowedHeaders: [
      'content-type',
      'authorization',
      'idempotency-key',
      'if-match',
      'x-request-id',
      'x-sandbox-session',
      'accept-language',
    ],
    exposedHeaders: ['etag', 'x-request-id', 'idempotent-replay'],
  });

  app.enableShutdownHooks();

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV, sandbox: isSandboxPermitted(env) },
    'API listening',
  );

  // Drain in-flight requests before closing the pool, so a deploy does not abort a
  // transaction that is mid-commit.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((e) => {
  logger.error({ err: e }, 'failed to start API');
  process.exit(1);
});
