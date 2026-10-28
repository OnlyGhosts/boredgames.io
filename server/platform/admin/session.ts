/**
 * The admin's sign-in: one password (ADMIN_PASSWORD), compared in constant time, and a signed
 * session cookie. The signing key is derived from the password and a server key, so changing the
 * password signs everyone out. Wrong guesses are slowed down per network.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'bg_admin';
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/** HMAC-SHA256 keyed with the server key over the password. */
export function sessionKey(password: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(password).digest();
}

function mac(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** `base64url(JSON {exp})` + "." + its HMAC. */
export function signSession(key: Buffer, exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${payload}.${mac(key, payload)}`;
}

export function verifySession(key: Buffer, value: string, now: number): boolean {
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(key, payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}

/** Constant-time comparison of SHA-256 digests, so neither length nor content leaks through timing. */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const FREE_FAILURES = 5;
const MAX_DELAY_S = 300;
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_NETWORKS = 10_000;

export type LoginCheck = { ok: true } | { ok: false; retryAfterS: number };

/** Five wrong passwords per network for free; after that each try waits 2^(n-5) seconds (at most 300) from the last failure. */
export class LoginLimiter {
  private readonly failures = new Map<string, { n: number; lastAt: number }>();

  check(network: string, now: number): LoginCheck {
    const entry = this.failures.get(network);
    if (!entry || entry.n < FREE_FAILURES) return { ok: true };
    const waitMs = Math.min(2 ** (entry.n - FREE_FAILURES), MAX_DELAY_S) * 1000;
    const left = entry.lastAt + waitMs - now;
    return left > 0 ? { ok: false, retryAfterS: Math.ceil(left / 1000) } : { ok: true };
  }

  fail(network: string, now: number): void {
    if (!this.failures.has(network) && this.failures.size >= MAX_NETWORKS) {
      this.prune(now);
      // Still full: the oldest entry goes, so the map stays bounded.
      if (this.failures.size >= MAX_NETWORKS) this.failures.delete(this.failures.keys().next().value!);
    }
    const entry = this.failures.get(network);
    this.failures.set(network, { n: (entry?.n ?? 0) + 1, lastAt: now });
  }

  succeed(network: string): void {
    this.failures.delete(network);
  }

  private prune(now: number): void {
    for (const [network, entry] of this.failures) if (now - entry.lastAt >= FORGET_AFTER_MS) this.failures.delete(network);
  }
}
