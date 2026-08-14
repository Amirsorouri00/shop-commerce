import pino from 'pino';
import { createRequire } from 'node:module';
import { isAppError, type ErrorSeverity } from '@xb/core';
import { getContext } from './context.ts';

/**
 * Structured logging.
 *
 * Three decisions worth stating:
 *
 *   - pino, because it serialises to JSON without blocking the event loop. A logger that
 *     stringifies synchronously under load becomes the bottleneck it was meant to observe.
 *
 *   - The correlation id is injected by a mixin, not passed at each call site. Call sites
 *     that must remember to include it are call sites that eventually don't.
 *
 *   - Redaction is declared here and applied by the logger itself. Relying on developers
 *     not to log a token is not a security control.
 */

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
  'code',
  'secret',
  'apiKey',
  'cardNumber',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
];

export type Logger = pino.Logger;

export interface LoggerOptions {
  readonly level?: string;
  readonly serviceName?: string;
  readonly pretty?: boolean;
}

/**
 * Is pino-pretty actually loadable?
 *
 * It is a development convenience, so a missing or broken install must degrade to plain JSON
 * rather than prevent the process from starting. A logger that refuses to boot takes the
 * whole service with it, which is a spectacularly bad trade for prettier output.
 */
function prettyTransportAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? process.env['LOG_LEVEL'] ?? 'info';
  const serviceName = options.serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'xb';
  const pretty =
    (options.pretty ?? process.env['NODE_ENV'] === 'development') && prettyTransportAvailable();

  return pino({
    level,
    base: { service: serviceName },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    // Every line gets the ambient correlation context without any call site asking for it.
    mixin() {
      const ctx = getContext();
      if (!ctx) return {};
      return {
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        source: ctx.source,
      };
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

/** The process-wide logger. Modules take a child of this rather than creating their own. */
export const logger: Logger = createLogger();

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

/**
 * Log an error at the level its own taxonomy declares.
 *
 * This is why severity lives on the error class: a 404 inside a catch block is not an
 * error-level event, and deciding that at each throw site produces inconsistent noise.
 */
export function logError(log: Logger, e: unknown, message: string, extra?: Record<string, unknown>): void {
  const severity: ErrorSeverity = isAppError(e) ? e.severity : 'error';
  const payload = {
    err: e,
    ...(isAppError(e) ? { errorCode: e.code, retryable: e.retryable, details: e.details } : {}),
    ...extra,
  };

  switch (severity) {
    case 'debug':
      log.debug(payload, message);
      break;
    case 'info':
      log.info(payload, message);
      break;
    case 'warn':
      log.warn(payload, message);
      break;
    default:
      log.error(payload, message);
  }
}
