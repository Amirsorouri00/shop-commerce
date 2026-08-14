/**
 * The proxy pipeline.
 *
 * A port is an interface. An adapter implements it. Everything between them — timeout,
 * retry, circuit breaker, cache, telemetry — is a *decorator that implements the same
 * interface*, so the domain service is unaware any of it exists.
 *
 * The naive way to build this is a class per concern that hand-delegates every method. That
 * breaks the moment a port grows a method someone forgets to forward. Instead we wrap the
 * adapter in a JS `Proxy`: any method, present or future, is intercepted automatically and
 * run through the same layer stack.
 *
 * Layers compose like middleware — outermost first, each calling `next()`:
 *
 *     instrument( cache( breaker( retry( timeout( adapter ) ) ) ) )
 *
 * The order is not arbitrary; see `docs/` §04 for why each layer sits where it does.
 */

export interface Invocation {
  /** Port name, e.g. `FxPort`. Used for metrics labels and error messages. */
  readonly port: string;
  /** Concrete provider currently selected, e.g. `zarinpal`. */
  readonly provider: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export type Next = () => Promise<unknown>;

/** A layer receives the invocation and the rest of the chain. */
export type Layer = (inv: Invocation, next: Next) => Promise<unknown>;

export interface PipelineOptions {
  readonly port: string;
  readonly provider?: string;
  /** Methods to leave unwrapped — synchronous predicates like `supports(url)`. */
  readonly passthrough?: readonly string[];
}

/**
 * Wrap a target so every async method call runs through `layers`.
 *
 * Layers are applied outermost-first: `layers[0]` sees the call before `layers[1]`.
 */
export function withLayers<T extends object>(
  target: T,
  layers: readonly Layer[],
  options: PipelineOptions,
): T {
  const passthrough = new Set(options.passthrough ?? []);
  // Wrapped methods are memoised so repeated property access returns a stable reference —
  // otherwise `a.method === a.method` is false, which breaks any caller that stores it.
  const cache = new Map<string, unknown>();

  return new Proxy(target, {
    get(obj, prop, receiver) {
      const original = Reflect.get(obj, prop, receiver);

      if (typeof original !== 'function' || typeof prop !== 'string' || passthrough.has(prop)) {
        return original;
      }

      const memoised = cache.get(prop);
      if (memoised) return memoised;

      const wrapped = (...args: unknown[]): unknown => {
        const inv: Invocation = {
          port: options.port,
          provider: options.provider ?? resolveProviderName(obj),
          method: prop,
          args,
        };

        const base: Next = () => Promise.resolve(original.apply(obj, args));
        const chain = layers.reduceRight<Next>(
          (next, layer) => () => layer(inv, next),
          base,
        );

        return chain();
      };

      cache.set(prop, wrapped);
      return wrapped;
    },
  }) as T;
}

/** Adapters may declare their own name; otherwise fall back to the class name. */
function resolveProviderName(obj: object): string {
  const named = obj as { readonly name?: unknown };
  return typeof named.name === 'string' ? named.name : obj.constructor.name;
}

/** Every adapter carries an identity so telemetry and failover can name it. */
export interface NamedProvider {
  readonly name: string;
}
