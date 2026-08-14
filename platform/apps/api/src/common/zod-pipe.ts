import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, output } from 'zod';
import { parseOrThrow } from '@xb/validation';

/**
 * Zod validation pipe.
 *
 * `parseOrThrow` rather than `schema.parse`: the latter raises a `ZodError` with
 * English-only messages that the exception filter would have to special-case. This produces
 * a `ValidationError` carrying bilingual issues, which the filter already knows how to
 * render.
 *
 * Note this returns the schema's *output* type, so transforms run before the handler sees
 * the value — a phone number reaches the handler already normalised to E.164.
 */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): output<S> {
    return parseOrThrow(this.schema, value);
  }
}

/** Convenience for `@Body(zodBody(schema))`. */
export const zodBody = <S extends ZodTypeAny>(schema: S): ZodValidationPipe<S> =>
  new ZodValidationPipe(schema);
