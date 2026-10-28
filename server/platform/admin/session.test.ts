import { describe, expect, it } from 'vitest';
import { LoginLimiter, passwordMatches, sessionKey, signSession, verifySession } from './session.js';

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('admin sessions', () => {
  const key = sessionKey('correct horse', 'server-secret');

  it('verifies a session it signed until it expires', () => {
    const value = signSession(key, NOW + 30 * DAY);
    expect(verifySession(key, value, NOW)).toBe(true);
    expect(verifySession(key, value, NOW + 30 * DAY - 1)).toBe(true);
    expect(verifySession(key, value, NOW + 30 * DAY)).toBe(false);
  });

  it('refuses a tampered value, garbage, or one signed before the password changed', () => {
    const value = signSession(key, NOW + DAY);
    const [payload, mac] = value.split('.') as [string, string];
    const later = Buffer.from(JSON.stringify({ exp: NOW + 365 * DAY })).toString('base64url');
    expect(verifySession(key, `${later}.${mac}`, NOW)).toBe(false);
    expect(verifySession(key, `${payload}.${mac.slice(0, -2)}AA`, NOW)).toBe(false);
    expect(verifySession(key, '', NOW)).toBe(false);
    expect(verifySession(key, 'not-a-session', NOW)).toBe(false);
    expect(verifySession(key, `${payload}.`, NOW)).toBe(false);
    expect(verifySession(sessionKey('new password', 'server-secret'), value, NOW)).toBe(false);
    expect(verifySession(sessionKey('correct horse', 'other-secret'), value, NOW)).toBe(false);
  });

  it('compares passwords exactly', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true);
    expect(passwordMatches('correct hors', 'correct horse')).toBe(false);
    expect(passwordMatches('', 'correct horse')).toBe(false);
    expect(passwordMatches('Correct horse', 'correct horse')).toBe(false);
  });
});

describe('LoginLimiter', () => {
  it('allows five failures, then makes each next try wait twice as long', () => {
    const limiter = new LoginLimiter();
    let now = NOW;
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('net', now)).toEqual({ ok: true });
      limiter.fail('net', now);
    }
    expect(limiter.check('net', now)).toEqual({ ok: false, retryAfterS: 1 });
    expect(limiter.check('other-net', now)).toEqual({ ok: true });
    now += 1000;
    expect(limiter.check('net', now)).toEqual({ ok: true });
    limiter.fail('net', now);
    expect(limiter.check('net', now)).toEqual({ ok: false, retryAfterS: 2 });
    now += 1500;
    expect(limiter.check('net', now)).toEqual({ ok: false, retryAfterS: 1 });
  });

  it('caps the wait at five minutes and forgets a network after a success', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 30; i++) limiter.fail('net', NOW);
    expect(limiter.check('net', NOW)).toEqual({ ok: false, retryAfterS: 300 });
    limiter.succeed('net');
    expect(limiter.check('net', NOW)).toEqual({ ok: true });
  });
});
