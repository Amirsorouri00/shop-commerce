import type { z } from 'zod';
import { ValidationError, type ValidationIssue } from '@xb/core';
import { issueCode, issueMessage, issueParams, type FieldLabels } from './messages.ts';
import { FIELD_LABELS } from './schemas.ts';

/**
 * Turn Zod's structured issues into our client-facing issue shape.
 *
 * One issue per failed field. Zod can emit several for a single field (a union tries every
 * branch), so we keep the first per path — showing a user three contradictory reasons that
 * one value is wrong is worse than showing one.
 */
export function translateIssues(
  issues: readonly z.ZodIssue[],
  labels: FieldLabels = FIELD_LABELS,
): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];

  for (const issue of issues) {
    const path = issue.path.join('.');
    if (seen.has(path)) continue;
    seen.add(path);

    const params = issueParams(issue);
    out.push({
      path,
      code: issueCode(issue),
      ...(params ? { params } : {}),
      message: issueMessage(issue, labels),
    });
  }

  return out;
}

/**
 * Parse or throw a `ValidationError`.
 *
 * This is the only sanctioned way to validate. Calling `schema.parse` directly throws a
 * `ZodError`, which the exception filter would have to special-case — and which carries
 * English-only messages.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  labels?: FieldLabels,
): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new ValidationError(translateIssues(result.error.issues, labels));
}

/** Non-throwing variant, for places that prefer a Result-shaped branch. */
export function parseSafe<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  labels?: FieldLabels,
): { ok: true; data: z.output<S> } | { ok: false; issues: ValidationIssue[] } {
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, issues: translateIssues(result.error.issues, labels) };
}
