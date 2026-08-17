import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NotFoundError } from '@xb/core';
import { isSandboxPermitted, type Env } from '@xb/contracts';
import { SandboxController } from './sandbox.module.ts';

/**
 * WP-01 regression tests — sandbox control-plane containment (G-02, G-03 containment).
 *
 * Two kinds of assertion here, and the second matters more than it looks.
 *
 * The behavioural tests instantiate the controller and call every handler, checking that a
 * disabled sandbox is indistinguishable from an absent one.
 *
 * The structural tests read the source. That is unusual, and it is deliberate: the defect
 * being fixed was *a missing decorator on a class*, which no amount of exercising the happy
 * path would have caught. A route added later without the gate is the exact regression this
 * package exists to prevent, so the test enumerates the routes in the file rather than the
 * routes someone remembered to list here.
 */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'sandbox.module.ts'),
  'utf8',
);

/** The controller body only — the service above it also contains methods. */
const controllerBody = source.slice(source.indexOf('export class SandboxController'));

/** Every HTTP route declared on the controller, read from source rather than assumed. */
const HTTP_VERBS = 'Get|Post|Delete|Put|Patch|All|Options|Head';

/**
 * Matches a path argument *or* an empty one — `@Get()` with no path is a real route and was
 * invisible to an earlier version of this pattern, which meant a route could be added without
 * a gate and every test here would still pass.
 */
const routes = [...controllerBody.matchAll(new RegExp(`@(${HTTP_VERBS})\\((?:'([^']*)')?\\)`, 'g'))].map(
  (m) => `${m[1]} ${m[2] ?? ''}`.trim(),
);

const envWith = (over: Partial<Env>): Env =>
  ({
    NODE_ENV: 'development',
    SANDBOX_MODE: 'disabled',
    SANDBOX_ALLOW_IN_PRODUCTION: false,
    ...over,
  }) as Env;

const controllerFor = (env: Env) =>
  new SandboxController(
    {} as never, // SandboxService — never reached; the gate throws first
    {} as never, // OrderService
    env,
  );

describe('every sandbox route is enumerated, not sampled', () => {
  it('finds the full route set on the controller', () => {
    // If a route is added, this fails and forces the author to extend the coverage below
    // rather than silently leaving a new hole.
    expect(routes.sort()).toEqual(
      [
        'Get scenarios',
        'Post sessions',
        'Get sessions/:id',
        'Post sessions/:id/advance',
        'Post sessions/:id/reset',
        'Delete sessions/:id',
        'Get gateway',
        'Post gateway/settle',
      ].sort(),
    );
  });

  it('gates every route on sandbox permission', () => {
    // One `assertSandboxPermitted()` call per route, plus the private method's own definition.
    const calls = controllerBody.split('this.assertSandboxPermitted();').length - 1;
    expect(calls).toBe(routes.length);
  });
});

describe('the control plane is not anonymous (G-02)', () => {
  it('requires an operator role at the class level', () => {
    // The defect was a class-level `@Public()`. Its absence is the fix, and the presence of a
    // role requirement is what replaces it.
    expect(controllerBody).not.toMatch(/^@Public\(\)\s*$/m);
    expect(source).toMatch(/@Roles\('ops', 'finance', 'admin'\)\s*\n@Controller\('v1\/sandbox'\)/);
  });

  it('exempts only the two browser-reachable gateway routes', () => {
    // A customer's browser is redirected to these mid-checkout and carries no bearer token,
    // so they cannot require one. Any *other* `@Public()` on this controller would be a hole.
    // Tolerates decorators interleaved between @Public() and the HTTP verb — an earlier
    // version required them adjacent, so an interleaved @HttpCode would have hidden a public
    // route from this check.
    const publicRoutes = [
      ...controllerBody.matchAll(
        new RegExp(`@Public\\(\\)(?:\\s*@[A-Za-z]+\\([^)]*\\))*?\\s*@(${HTTP_VERBS})\\((?:'([^']*)')?\\)`, 'g'),
      ),
    ].map((m) => `${m[1]} ${m[2] ?? ''}`.trim());

    expect(publicRoutes.sort()).toEqual(['Get gateway', 'Post gateway/settle'].sort());
  });
});

describe('a disabled sandbox is indistinguishable from an absent one (G-01, G-03)', () => {
  const disabled = controllerFor(envWith({ SANDBOX_MODE: 'disabled' }));

  const invocations: [string, () => unknown][] = [
    ['scenarios', () => disabled.scenarios()],
    ['create', () => disabled.create({ scenarioId: 'HAPPY_PATH' })],
    ['get', () => disabled.get('s1')],
    ['advance', () => disabled.advance('s1', { hours: 24 })],
    ['reset', () => disabled.reset('s1')],
    ['remove', () => disabled.remove('s1')],
    ['gatewayPage', () => disabled.gatewayPage('ref', '/', {} as never)],
    ['gatewaySettle', () => disabled.gatewaySettle({ ref: 'r' }, {} as never)],
  ];

  it('covers every route declared on the controller', () => {
    expect(invocations.length).toBe(routes.length);
  });

  it.each(invocations)('%s throws NotFound rather than acting', async (_name, call) => {
    await expect(async () => await call()).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the settle route is gated in production (G-03 containment)', () => {
  it('404s when sandbox is not permitted in production', async () => {
    const prod = controllerFor(envWith({ NODE_ENV: 'production', SANDBOX_MODE: 'enabled' }));
    // `isSandboxPermitted` refuses this combination; the schema refuses it at boot too, so
    // this asserts the second line of defence rather than the first.
    expect(isSandboxPermitted(envWith({ NODE_ENV: 'production', SANDBOX_MODE: 'enabled' }))).toBe(
      false,
    );
    await expect(async () => await prod.gatewaySettle({ ref: 'r' }, {} as never)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('remains reachable in production only under an explicit policy', () => {
    expect(
      isSandboxPermitted(
        envWith({
          NODE_ENV: 'production',
          SANDBOX_MODE: 'enabled',
          SANDBOX_ALLOW_IN_PRODUCTION: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('the session header is inert when the sandbox is not permitted', () => {
  const middlewareSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'common', 'http.ts'),
    'utf8',
  );

  it('reads x-sandbox-session only where sandbox is permitted', () => {
    // Without this the header still reaches the ambient context with the sandbox disabled,
    // and routeByContext swaps in simulated adapters for any session id still in Redis —
    // sandbox behaviour reachable with no sandbox route registered.
    expect(middlewareSource).toMatch(
      /this\.sandboxPermitted \? req\.headers\['x-sandbox-session'\] : undefined/,
    );
  });

  it('resolves the policy from the same helper as the controller and composition root', () => {
    expect(middlewareSource).toMatch(/isSandboxPermitted\(loadEnv\(\)\)/);
  });
});

describe('every direct read of the session header is gated (adversarial review finding)', () => {
  // The middleware gate covers the ambient-context path. It does NOT cover call sites that
  // read the header themselves — and `createOrder` does exactly that, stamping the value onto
  // the order row. Ungated, an authenticated customer could mark real orders as sandbox data
  // in a process with no sandbox, and the operator order search excludes sandbox rows by
  // default, so those orders would quietly leave the default view.
  const commerceSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'commerce.module.ts'),
    'utf8',
  );

  it('finds every direct @Headers read of x-sandbox-session across the API', () => {
    const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..');
    const readers = [
      ['commerce.module.ts', commerceSource],
      ['common/http.ts', readFileSync(join(apiSrc, 'common', 'http.ts'), 'utf8')],
    ].filter(([, src]) => /x-sandbox-session/.test(src as string));

    // Enumerated rather than assumed: if a third reader appears, this fails and forces it to
    // be gated too.
    expect(readers.map(([name]) => name).sort()).toEqual(
      ['commerce.module.ts', 'common/http.ts'].sort(),
    );
  });

  it('gates the createOrder stamp on sandbox permission', () => {
    expect(commerceSource).toMatch(
      /isSandboxPermitted\(this\.env\)\s*\?\s*sandboxSession\s*:\s*undefined/,
    );
  });

  it('does not validate the session — that is WP-03, deliberately out of scope here', () => {
    // Guards against scope creep in the other direction: WP-01 owns the environment gate only.
    expect(commerceSource).not.toMatch(/sandboxStore|SandboxSessionStore|validateSandboxSession/);
  });
});

describe('the worker does not resurrect sandbox routing from a stamped row', () => {
  const workerSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'worker', 'src', 'main.ts'),
    'utf8',
  );

  it('gates both sandbox re-entry points on sandbox permission', () => {
    // Two places read order.sandboxSessionId and re-enter sandbox context. Both must be gated,
    // or a row stamped elsewhere swaps simulated adapters into a production worker.
    const gated = [...workerSource.matchAll(/&& sandboxPermitted|sandboxSessionId && sandboxPermitted/g)];
    const reentries = [...workerSource.matchAll(/sandboxSessionId(?:\s*&&|\s*\))/g)];
    expect(gated.length).toBeGreaterThanOrEqual(2);
    expect(reentries.length).toBeGreaterThan(0);
  });

  it('resolves the policy once from the shared helper', () => {
    expect(workerSource).toMatch(/const sandboxPermitted = isSandboxPermitted\(env\)/);
  });
});
