import {
  Catch,
  Injectable,
  type NestMiddleware,
  type ArgumentsHost,
  type ExceptionFilter,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type CanActivate,
  HttpException,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import {
  AppError,
  InternalError,
  ForbiddenError,
  UnauthorizedError,
  isAppError,
  type ErrorSeverity,
  type LocalizedMessage,
} from '@xb/core';
import { createContext, runWithContext, getContext, logger, logError, metrics, METRIC } from '@xb/observability';
import type { Observable } from 'rxjs';

/**
 * HTTP cross-cutting concerns.
 *
 * One filter, one correlation middleware, one idempotency interceptor. Every handler in the
 * application benefits from all three without importing any of them.
 */

// ─────────────────────────── correlation ───────────────────────────

/**
 * Establish the async context for the request.
 *
 * Accepts an inbound `x-request-id` so a correlation id set by a gateway or a client survives
 * into our logs, but always generates one when absent — a request without a correlation id is
 * a request nobody can trace afterwards.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'] & { headers: Record<string, string | string[] | undefined> }, res: unknown, next: () => void): void {
    const inbound = req.headers['x-request-id'];
    const correlationId = typeof inbound === 'string' && inbound.length > 0 ? inbound : undefined;

    const localeHeader = req.headers['accept-language'];
    const locale = typeof localeHeader === 'string' && localeHeader.startsWith('en') ? 'en' : 'fa';

    // Sandbox routing rides on the ambient context, so no service signature mentions it.
    const sandboxHeader = req.headers['x-sandbox-session'];
    const sandboxSessionId = typeof sandboxHeader === 'string' ? sandboxHeader : undefined;

    const ctx = createContext({
      ...(correlationId ? { correlationId } : {}),
      ...(sandboxSessionId ? { sandboxSessionId } : {}),
      locale,
      source: 'http',
    });

    runWithContext(ctx, () => next());
  }
}

// ─────────────────────────── exception filter ───────────────────────────

/**
 * The single place an error becomes an HTTP response.
 *
 * Handlers never set a status code and never format an error body. The status comes from the
 * error class and the body is always the same envelope, so a client can rely on its shape
 * without knowing which endpoint failed.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const traceId = getContext()?.correlationId ?? 'unknown';

    // An HttpException that already carries our envelope is passed through untouched.
    // Collapsing it into an InternalError would turn a deliberate 400 into a 500 and hide
    // the machine-readable code the client needs to branch on.
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (isErrorEnvelope(body)) {
        const status = exception.getStatus();
        logger.info(
          { method: request.method, url: request.url, status, errorCode: body.error.code },
          'request rejected',
        );
        metrics.counter(METRIC.httpRequest, 1, {
          method: request.method,
          status: String(status),
          errorCode: body.error.code,
        });
        void reply
          .status(status)
          .header('x-request-id', traceId)
          .send({ ...body, error: { ...body.error, traceId } });
        return;
      }
    }

    const error = this.normalize(exception);

    logError(logger, error, 'request failed', {
      method: request.method,
      url: request.url,
      status: error.httpStatus,
    });

    metrics.counter(METRIC.httpRequest, 1, {
      method: request.method,
      status: String(error.httpStatus),
      errorCode: error.code,
    });

    const headers: Record<string, string> = { 'x-request-id': traceId };
    if (error.code === 'RATE_LIMITED') {
      const retryAfter = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retryAfter) headers['retry-after'] = String(retryAfter);
    }

    void reply.status(error.httpStatus).headers(headers).send(error.toEnvelope(traceId));
  }

  /** Everything becomes an AppError, so the response shape is never conditional. */
  private normalize(exception: unknown): AppError {
    if (isAppError(exception)) return exception;

    // Nest's own exceptions (404 from the router, 413 from the body limit) reach here too.
    //
    // Their status must be preserved. Collapsing everything that is not 401/403 into a 500
    // turns "no such route" into "our server is broken", which is both wrong and alarming.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 401) return new UnauthorizedError(exception.message);
      if (status === 403) return new ForbiddenError(exception.message);
      if (status < 500) return new PassthroughHttpError(status, exception.message);
      return new InternalError(exception.message, { cause: exception });
    }

    return new InternalError(
      exception instanceof Error ? exception.message : String(exception),
      { cause: exception },
    );
  }
}

/**
 * Carries a framework-raised 4xx through the filter with its status intact.
 *
 * Exists so a router 404 or a body-limit 413 keeps its meaning instead of being reported as
 * an internal failure. Still emitted in the standard envelope, so clients see one shape.
 */
class PassthroughHttpError extends AppError {
  readonly code: string;
  readonly httpStatus: number;
  readonly severity: ErrorSeverity = 'debug';
  readonly localized: LocalizedMessage;

  constructor(status: number, message: string) {
    super(message);
    this.httpStatus = status;
    this.code = status === 404 ? 'NOT_FOUND' : `HTTP_${status}`;
    this.localized =
      status === 404
        ? { en: "That endpoint doesn't exist.", fa: 'این مسیر وجود ندارد.' }
        : { en: 'That request could not be processed.', fa: 'این درخواست قابل پردازش نبود.' };
  }
}

/** Does this response body already speak our error envelope? */
function isErrorEnvelope(
  body: unknown,
): body is { error: { code: string; message: { en: string; fa: string }; traceId: string } } {
  if (typeof body !== 'object' || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown };
  return (
    typeof e.code === 'string' &&
    typeof e.message === 'object' &&
    e.message !== null &&
    typeof (e.message as { fa?: unknown }).fa === 'string'
  );
}

// ─────────────────────────── auth ───────────────────────────

export interface AuthenticatedActor {
  readonly id: string;
  readonly kind: 'customer' | 'operator';
  readonly role: string;
}

export const PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export const ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Pull the authenticated actor into a handler parameter. */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest & { actor?: AuthenticatedActor }>();
  return request.actor;
});

export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedActor>;
}

/**
 * JWT guard.
 *
 * Default-deny: every route requires authentication unless explicitly marked `@Public()`.
 * The inverse — opt-in protection — means a new endpoint is unauthenticated until somebody
 * remembers to guard it, and the ones people forget are rarely the harmless ones.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { actor?: AuthenticatedActor }>();

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing bearer token');

    const actor = await this.verifier.verifyAccessToken(header.slice(7));
    request.actor = actor;

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required && required.length > 0 && !required.includes(actor.role)) {
      throw new ForbiddenError(`Requires one of: ${required.join(', ')}`, {
        details: { actorRole: actor.role, required },
      });
    }

    return true;
  }
}

// ─────────────────────────── idempotency ───────────────────────────

export interface IdempotencyStore {
  reserve(input: {
    key: string;
    endpoint: string;
    requestHash: string;
    customerId?: string;
  }): Promise<
    | { status: 'reserved' }
    | { status: 'replay'; responseStatus: number; responseBody: unknown }
    | { status: 'in-flight' }
    | { status: 'conflict' }
  >;
  complete(key: string, responseStatus: number, responseBody: unknown): Promise<void>;
  release(key: string): Promise<void>;
}

export const IDEMPOTENT_KEY = 'requiresIdempotency';
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);

/**
 * Idempotency for mutations that move money or call a third party.
 *
 * Replays the stored response byte-identically. Three cases are distinguished deliberately:
 *
 *   - **replay**: the same key and the same body — return exactly what we returned before.
 *   - **conflict**: the same key with a *different* body — a client bug, surfaced as 409
 *     rather than silently answering with the wrong cached response.
 *   - **in-flight**: the original request is still running — 409, because returning a
 *     partial answer or duplicating the work are both worse.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { actor?: AuthenticatedActor }>();

    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8) {
      throw new HttpException(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: {
              en: 'This request requires an Idempotency-Key header.',
              fa: 'این درخواست به هدر Idempotency-Key نیاز دارد.',
            },
            traceId: getContext()?.correlationId ?? 'unknown',
          },
        },
        400,
      );
    }

    const endpoint = `${request.method} ${request.routeOptions?.url ?? request.url}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    const reservation = await this.store.reserve({
      key,
      endpoint,
      requestHash,
      ...(request.actor?.kind === 'customer' ? { customerId: request.actor.id } : {}),
    });

    if (reservation.status === 'replay') {
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      void reply.status(reservation.responseStatus).header('idempotent-replay', 'true');
      return new (await import('rxjs')).Observable((subscriber) => {
        subscriber.next(reservation.responseBody);
        subscriber.complete();
      });
    }

    if (reservation.status === 'conflict') {
      throw new HttpException(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: {
              en: 'This request was already submitted with different details.',
              fa: 'این درخواست پیش‌تر با اطلاعات متفاوتی ثبت شده است.',
            },
            traceId: getContext()?.correlationId ?? 'unknown',
          },
        },
        409,
      );
    }

    if (reservation.status === 'in-flight') {
      throw new HttpException(
        {
          error: {
            code: 'REQUEST_IN_FLIGHT',
            message: {
              en: 'This request is still being processed. Please wait.',
              fa: 'این درخواست هنوز در حال پردازش است. لطفاً منتظر بمانید.',
            },
            traceId: getContext()?.correlationId ?? 'unknown',
          },
        },
        409,
      );
    }

    const { tap, catchError } = await import('rxjs/operators');
    const { throwError } = await import('rxjs');

    return next.handle().pipe(
      tap((body: unknown) => {
        const status = context.switchToHttp().getResponse<FastifyReply>().statusCode;
        void this.store.complete(key, status, body);
      }),
      catchError((err: unknown) => {
        // Release on failure so the client can genuinely retry. Holding the key would make a
        // transient failure permanent for that key.
        void this.store.release(key);
        return throwError(() => err);
      }),
    );
  }
}
