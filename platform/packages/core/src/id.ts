import { randomUUID, randomBytes } from 'node:crypto';

/**
 * Identifier generation.
 *
 * UUIDv7 for anything stored in Postgres. v7 is time-ordered, so inserts land at the end of
 * the B-tree instead of scattering across it — which for an append-heavy table like
 * `order_event` is the difference between a healthy index and a fragmented one. It also
 * gives cursor pagination a natural sort key for free.
 */

export function uuid(): string {
  return randomUUID();
}

/**
 * UUIDv7: 48-bit millisecond timestamp, 4-bit version, 12 bits of sub-millisecond counter,
 * 2-bit variant, 62 bits of randomness. Monotonic within a millisecond under load.
 */
let lastTimestamp = 0;
let counter = 0;

export function uuidv7(): string {
  const now = Date.now();
  if (now === lastTimestamp) {
    counter = (counter + 1) & 0xfff;
  } else {
    lastTimestamp = now;
    counter = randomBytes(2).readUInt16BE(0) & 0xfff;
  }

  const bytes = randomBytes(16);

  // 48-bit big-endian timestamp
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // version 7 in the high nibble, then the 12-bit counter
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // RFC 4122 variant
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Short, URL-safe, human-quotable reference for support conversations. Not a primary key. */
export function publicRef(prefix: string): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I — they get misread on the phone
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}-${out}`;
}
