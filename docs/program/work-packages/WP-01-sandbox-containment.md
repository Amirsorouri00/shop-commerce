# WP-01 — Sandbox fail-closed containment

**Priority** P0 · **Severity** security · **Capability** environment safety · **Contexts** composition root, configuration, sandbox control plane · **Tranche** 0

## Why

Three verified defects let anyone reaching the API operate the sandbox control plane and move money:

- **G-01** — `SANDBOX_ENABLED` is `.optional().transform(v => v !== 'false')` (`packages/contracts/src/env.ts:63-67`), so **unset yields `true`**, under a comment reading "Off in production." It is referenced only by a startup log line (`main.ts:91`) and gates nothing. `SandboxModule` is registered unconditionally.
- **G-02** — `SandboxController` is `@Public()` at class level (`sandbox.module.ts:111`): session create, clock advance, reset and delete are anonymous.
- **G-03 (containment portion)** — `POST /v1/sandbox/gateway/settle` (`sandbox.module.ts:188-197`) has **no environment gate**, unlike `dev-gateway.module.ts:42-44` which 404s in production.

**Containment is not the fix.** This package stops the bleeding; WP-02 and WP-03 remove the structural cause. Do not close G-03 on this package alone.

## Scope

**Included:** strict `SANDBOX_MODE` enum with no default coercion (unset = disabled; malformed = **startup failure**); conditional `SandboxModule` registration; production refusal unless an explicitly approved policy flag is set; **404 (never 403)** when disabled; `X-Sandbox-Session` not consulted at all when disabled; environment gate on the sandbox settle route; **interim authentication** on the control plane requiring any authenticated operator.

**Excluded:** fine-grained sandbox permissions (WP-06 supplies the model); server-authoritative provenance (WP-03); callback verification (WP-02); financial isolation (WP-07).

## Architecture

Configuration schema; composition-root conditional registration; guard change on `SandboxController`; env check on the settle route. **No domain, persistence, event, or frontend change.**

**Interim authorization rationale:** full permission scoping needs WP-06, which is a Tranche-1 chain. Requiring *any authenticated operator* closes anonymous access now without waiting, and WP-06 replaces it with `sandbox:control:*`. This is the one place a temporary coarse check is correct — the alternative is leaving it anonymous for the length of the RBAC chain.

## Migration

Config-only. **Rollout risk:** any environment relying on the implicit default will stop having a sandbox until `SANDBOX_MODE=enabled` is set — intended, and must be communicated. Rollback: revert config.

## Tests

- Unset config → sandbox disabled; control routes **404**
- Malformed value → **startup failure**, not fallback
- `NODE_ENV=production` without the policy flag → startup failure
- `X-Sandbox-Session` ignored entirely when disabled
- Anonymous request to every sandbox control route → rejected (**enumerate all routes on `SandboxController`**, do not sample)
- Settle route → 404 in production

## Acceptance criteria

1. No configuration value causes sandbox to enable implicitly.
2. Every route on `SandboxController` rejects anonymous callers.
3. Disabled sandbox is indistinguishable from absent (404).
4. The existing suite still passes — **120 test sites / 132 executed cases** (`it.each` expands the difference) — and typecheck stays 16/16. An earlier draft said "132 tests," which is the case count, not the site count.

## Dependencies

**Prerequisites:** none — deliberately, so containment can ship first. **Dependents:** WP-02, WP-03.

## Risk

Low technical risk; **high value**. The main risk is *stopping here* and treating G-03 as closed.

## Context contract

Read: `packages/contracts/src/env.ts`, `apps/api/src/modules/sandbox.module.ts`, `apps/api/src/modules/dev-gateway.module.ts:36-46`, `apps/api/src/app.module.ts`, `apps/api/src/common/http.ts:220-260`, `docs/sandbox/security-and-isolation.md` §3.
