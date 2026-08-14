import { describe, it, expect, beforeEach } from 'vitest';
import { UpstreamError, ValidationError, TimeoutError, CircuitOpenError, ProviderUnavailableError } from '@xb/core';
import { withLayers } from './pipeline.ts';
import { timeout } from './timeout.ts';
import { retry } from './retry.ts';
import { circuitBreaker, BreakerRegistry } from './circuit-breaker.ts';
import { failover, ProviderRegistry, MemoryStickyStore } from './failover.ts';

interface DemoPort {
  fetch(id: string): Promise<string>;
  charge(id: string): Promise<string>;
  supports(url: string): boolean;
}

class Recorder implements DemoPort {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly behaviour: () => Promise<string> | string = () => 'ok',
  ) {}
  async fetch(): Promise<string> {
    this.calls++;
    return this.behaviour();
  }
  async charge(): Promise<string> {
    this.calls++;
    return this.behaviour();
  }
  supports(): boolean {
    return true;
  }
}

describe('withLayers', () => {
  it('wraps every method without the port listing them', async () => {
    const seen: string[] = [];
    const target = new Recorder('a');
    const proxied = withLayers<DemoPort>(
      target,
      [
        async (inv, next) => {
          seen.push(inv.method);
          return next();
        },
      ],
      { port: 'DemoPort', passthrough: ['supports'] },
    );

    await proxied.fetch('1');
    await proxied.charge('2');
    proxied.supports('x');

    expect(seen).toEqual(['fetch', 'charge']); // supports passed through unwrapped
  });

  it('returns a stable function reference across property reads', () => {
    const proxied = withLayers<DemoPort>(new Recorder('a'), [], { port: 'DemoPort' });
    expect(proxied.fetch).toBe(proxied.fetch);
  });

  it('applies layers outermost-first', async () => {
    const order: string[] = [];
    const proxied = withLayers<DemoPort>(
      new Recorder('a'),
      [
        async (_i, next) => {
          order.push('outer-in');
          const r = await next();
          order.push('outer-out');
          return r;
        },
        async (_i, next) => {
          order.push('inner-in');
          const r = await next();
          order.push('inner-out');
          return r;
        },
      ],
      { port: 'DemoPort' },
    );

    await proxied.fetch('1');
    expect(order).toEqual(['outer-in', 'inner-in', 'inner-out', 'outer-out']);
  });
});

describe('timeout', () => {
  it('fails a call that exceeds its deadline', async () => {
    const slow = withLayers<DemoPort>(
      new Recorder('slow', () => new Promise((r) => setTimeout(() => r('late'), 200))),
      [timeout({ ms: 30 })],
      { port: 'DemoPort' },
    );
    await expect(slow.fetch('1')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('honours a per-method override', async () => {
    const target = new Recorder('x', () => new Promise((r) => setTimeout(() => r('done'), 60)));
    const p = withLayers<DemoPort>(target, [timeout({ ms: 10, perMethod: { fetch: 300 } })], {
      port: 'DemoPort',
    });
    await expect(p.fetch('1')).resolves.toBe('done');
  });
});

describe('retry', () => {
  it('retries a retryable failure then succeeds', async () => {
    let n = 0;
    const target = new Recorder('flaky', () => {
      n++;
      if (n < 3) throw new UpstreamError('flaky', 'boom');
      return 'recovered';
    });
    const p = withLayers<DemoPort>(target, [retry({ attempts: 5, baseDelayMs: 1 })], {
      port: 'DemoPort',
    });

    await expect(p.fetch('1')).resolves.toBe('recovered');
    expect(n).toBe(3);
  });

  it('does not retry a non-retryable error', async () => {
    const target = new Recorder('bad', () => {
      throw new ValidationError([]);
    });
    const p = withLayers<DemoPort>(target, [retry({ attempts: 5, baseDelayMs: 1 })], {
      port: 'DemoPort',
    });

    await expect(p.fetch('1')).rejects.toBeInstanceOf(ValidationError);
    expect(target.calls).toBe(1); // a 422 fails identically every time
  });

  it('never retries a method declared non-idempotent', async () => {
    const target = new Recorder('pay', () => {
      throw new UpstreamError('gw', 'timeout');
    });
    const p = withLayers<DemoPort>(
      target,
      [retry({ attempts: 5, baseDelayMs: 1, nonRetryableMethods: ['charge'] })],
      { port: 'DemoPort' },
    );

    await expect(p.charge('1')).rejects.toBeInstanceOf(UpstreamError);
    expect(target.calls).toBe(1); // retrying a charge is how a customer pays twice
  });
});

describe('circuitBreaker', () => {
  let registry: BreakerRegistry;
  beforeEach(() => {
    registry = new BreakerRegistry();
  });

  const opts = { threshold: 3, resetMs: 50, minimumThroughput: 3, windowMs: 10_000 };

  it('opens after the threshold and then fails fast', async () => {
    const target = new Recorder('down', () => {
      throw new UpstreamError('down', '503');
    });
    const p = withLayers<DemoPort>(target, [circuitBreaker(opts, registry)], { port: 'P' });

    for (let i = 0; i < 3; i++) await expect(p.fetch('x')).rejects.toBeInstanceOf(UpstreamError);
    expect(target.calls).toBe(3);

    // Now open: the adapter is not called at all.
    await expect(p.fetch('x')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(target.calls).toBe(3);
  });

  it('does not count client errors against the provider', async () => {
    const target = new Recorder('fine', () => {
      throw new ValidationError([]);
    });
    const p = withLayers<DemoPort>(target, [circuitBreaker(opts, registry)], { port: 'P' });

    for (let i = 0; i < 6; i++) await expect(p.fetch('x')).rejects.toBeInstanceOf(ValidationError);

    // Still closed — the provider answered correctly; our requests were wrong.
    expect(registry.isQuarantined('P:fine')).toBe(false);
    expect(target.calls).toBe(6);
  });

  it('probes after the reset window and closes on success', async () => {
    let failing = true;
    const target = new Recorder('recovering', () => {
      if (failing) throw new UpstreamError('recovering', '503');
      return 'ok';
    });
    const p = withLayers<DemoPort>(
      target,
      [circuitBreaker({ ...opts, successesToClose: 1 }, registry)],
      { port: 'P' },
    );

    for (let i = 0; i < 3; i++) {
      await expect(p.fetch('x')).rejects.toBeInstanceOf(UpstreamError);
    }
    await expect(p.fetch('x')).rejects.toBeInstanceOf(CircuitOpenError);

    failing = false;
    await new Promise((r) => setTimeout(r, 60)); // let the reset window elapse

    await expect(p.fetch('x')).resolves.toBe('ok');
    expect(registry.isQuarantined('P:recovering')).toBe(false);
  });
});

describe('failover', () => {
  it('moves to the next provider on an infrastructure failure', async () => {
    const a = new Recorder('a', () => {
      throw new UpstreamError('a', 'down');
    });
    const b = new Recorder('b', () => 'from-b');

    const registry = new ProviderRegistry<DemoPort>('P', [
      { name: 'a', adapter: a, priority: 1 },
      { name: 'b', adapter: b, priority: 2 },
    ]);
    const port = failover(registry, { port: 'P', breakers: new BreakerRegistry() });

    await expect(port.fetch('x')).resolves.toBe('from-b');
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });

  it('does not fail over on a domain rejection', async () => {
    const a = new Recorder('a', () => {
      throw new ValidationError([]);
    });
    const b = new Recorder('b', () => 'from-b');

    const registry = new ProviderRegistry<DemoPort>('P', [
      { name: 'a', adapter: a, priority: 1 },
      { name: 'b', adapter: b, priority: 2 },
    ]);
    const port = failover(registry, { port: 'P', breakers: new BreakerRegistry() });

    // Asking provider b the same invalid question gets the same answer.
    await expect(port.fetch('x')).rejects.toBeInstanceOf(ValidationError);
    expect(b.calls).toBe(0);
  });

  it('pins a sticky key to the provider that first succeeded', async () => {
    const a = new Recorder('a', () => 'from-a');
    const b = new Recorder('b', () => 'from-b');
    const registry = new ProviderRegistry<DemoPort>('Pay', [
      { name: 'a', adapter: a, priority: 1 },
      { name: 'b', adapter: b, priority: 2 },
    ]);

    const store = new MemoryStickyStore();
    const port = failover(registry, {
      port: 'Pay',
      strategy: 'sticky',
      stickyKey: (_m, args) => `order:${String(args[0])}`,
      stickyStore: store,
      breakers: new BreakerRegistry(),
    });

    await expect(port.charge('order-1')).resolves.toBe('from-a');
    expect(store.get('order:order-1')).toBe('a');

    // Even with a healthy higher-priority alternative, the pin holds — a payment
    // retry must go back to the same gateway or the customer can be charged twice.
    await expect(port.charge('order-1')).resolves.toBe('from-a');
    expect(b.calls).toBe(0);
  });

  it('selects by capability', async () => {
    const amazon = new Recorder('amazon', () => 'amazon-product');
    const noon = new Recorder('noon', () => 'noon-product');

    const registry = new ProviderRegistry<DemoPort>('Store', [
      {
        name: 'amazon',
        adapter: amazon,
        priority: 1,
        supports: (_m, args) => String(args[0]).includes('amazon.ae'),
      },
      {
        name: 'noon',
        adapter: noon,
        priority: 2,
        supports: (_m, args) => String(args[0]).includes('noon.com'),
      },
    ]);
    const port = failover(registry, {
      port: 'Store',
      strategy: 'capability',
      breakers: new BreakerRegistry(),
    });

    await expect(port.fetch('https://noon.com/x')).resolves.toBe('noon-product');
    expect(amazon.calls).toBe(0);
  });

  it('reports provider unavailable when nothing can serve the call', async () => {
    const registry = new ProviderRegistry<DemoPort>('Store', [
      { name: 'amazon', adapter: new Recorder('amazon'), priority: 1, supports: () => false },
    ]);
    const port = failover(registry, {
      port: 'Store',
      strategy: 'capability',
      breakers: new BreakerRegistry(),
    });

    await expect(port.fetch('https://unknown.example/x')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});

describe('the full chain, composed', () => {
  it('caches nothing, retries transient failures, and trips the breaker in order', async () => {
    const registry = new BreakerRegistry();
    let attempts = 0;

    const target = new Recorder('combo', () => {
      attempts++;
      if (attempts <= 2) throw new UpstreamError('combo', 'transient');
      return 'eventually-ok';
    });

    const port = withLayers<DemoPort>(
      target,
      [
        circuitBreaker({ threshold: 10, resetMs: 1000, minimumThroughput: 10 }, registry),
        retry({ attempts: 4, baseDelayMs: 1 }),
        timeout({ ms: 500 }),
      ],
      { port: 'Combo' },
    );

    await expect(port.fetch('x')).resolves.toBe('eventually-ok');
    expect(attempts).toBe(3);
  });
});
