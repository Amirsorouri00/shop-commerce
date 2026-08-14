/**
 * DI tokens.
 *
 * Ports are interfaces, and interfaces do not exist at runtime, so they cannot be used as
 * Nest injection tokens. These symbols stand in for them — which also means a module
 * declares a dependency on `FX_PORT`, not on any concrete adapter, keeping the composition
 * root the only place that knows what is actually wired.
 */
export const ENV = Symbol('ENV');
export const DB = Symbol('DB');
export const REDIS = Symbol('REDIS');
export const BROKER = Symbol('BROKER');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export const STORE_PORT = Symbol('STORE_PORT');
export const FX_PORT = Symbol('FX_PORT');
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');
export const PROCUREMENT_PORT = Symbol('PROCUREMENT_PORT');
export const CARRIER_PORT = Symbol('CARRIER_PORT');
export const CUSTOMS_PORT = Symbol('CUSTOMS_PORT');
export const SMS_PORT = Symbol('SMS_PORT');
export const STORAGE_PORT = Symbol('STORAGE_PORT');

export const ADAPTERS = Symbol('ADAPTERS');
export const SANDBOX_STORE = Symbol('SANDBOX_STORE');
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
