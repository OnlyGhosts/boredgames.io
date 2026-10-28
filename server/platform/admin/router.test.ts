import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LiveRoomsResponse, Summary } from '../../../shared/platform/admin.js';
import { createApp, type App } from '../app.js';
import { MemoryDriver } from '../drivers/memory.js';
import { AVATAR } from '../drivers/testUtils.js';
import { MemoryAnalyticsStore } from './store.js';

const ADMIN = 'admin.boredgames.io';
const SITE = 'boredgames.io';
const PASSWORD = 'correct horse battery';
const ADMIN_HTML = '<!doctype html><title>Admin</title><div id="root"></div>';

const root = mkdtempSync(path.join(tmpdir(), 'bg-admin-'));
const adminDir = path.join(root, 'dist', 'admin');
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

/** An HTTP request with a chosen Host header (fetch will not set one). */
function call(base: string, host: string, method: string, route: string, opts: { body?: unknown; cookie?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { host };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.cookie) headers.cookie = opts.cookie;
    const req = httpRequest(`${base}${route}`, { method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function listen(app: App): Promise<string> {
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

/** The `name=value` part of a Set-Cookie header. */
function cookieOf(reply: Reply): string {
  const set = reply.headers['set-cookie']?.[0] ?? '';
  return set.split(';')[0] ?? '';
}

describe('the admin host without ADMIN_PASSWORD', () => {
  let app: App;
  let base = '';

  beforeAll(async () => {
    app = createApp({ driver: new MemoryDriver(), serveStatic: false, analytics: new MemoryAnalyticsStore(), env: { ADMIN_HOST: ADMIN }, adminDir });
    base = await listen(app);
  });
  afterAll(() => app.shutdown());

  it('says it is not set up and lets nobody in, without a 500', async () => {
    const page = await call(base, ADMIN, 'GET', '/');
    expect(page.status).toBe(503);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('ADMIN_PASSWORD');
    expect((await call(base, ADMIN, 'POST', '/api/admin/login', { body: { password: '' } })).status).toBe(503);
    expect((await call(base, ADMIN, 'POST', '/api/admin/login', { body: { password: 'anything' } })).status).toBe(503);
    expect((await call(base, ADMIN, 'GET', '/api/admin/summary')).status).toBe(503);
  });
});

describe('the admin host', () => {
  let app: App;
  let base = '';
  let now = Date.UTC(2026, 9, 28, 12, 0);
  const store = new MemoryAnalyticsStore();
  const driver = new MemoryDriver();

  beforeAll(async () => {
    mkdirSync(adminDir, { recursive: true });
    writeFileSync(path.join(adminDir, 'index.html'), ADMIN_HTML);
    app = createApp({
      driver,
      serveStatic: false,
      analytics: store,
      now: () => now,
      env: { ADMIN_HOST: ADMIN, ADMIN_PASSWORD: PASSWORD, ADMIN_SESSION_KEY: 'test-key' },
      adminDir,
    });
    base = await listen(app);
  });
  afterAll(() => app.shutdown());

  const login = (password: string) => call(base, ADMIN, 'POST', '/api/admin/login', { body: { password } });

  it('serves the dashboard page, never cached or indexed', async () => {
    const page = await call(base, ADMIN, 'GET', '/');
    expect(page.status).toBe(200);
    expect(page.text).toBe(ADMIN_HTML);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(page.headers['x-frame-options']).toBe('DENY');
  });

  it('refuses a wrong password, then slows the network down after five', async () => {
    for (let i = 0; i < 5; i++) expect((await login('wrong')).status).toBe(401);
    const limited = await login(PASSWORD);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('1');
    now += 1000;
    expect((await login('wrong')).status).toBe(401);
    expect((await login('wrong')).headers['retry-after']).toBe('2');
    now += 2000;
  });

  it('signs in with the right password: a 30-day cookie for this host only', async () => {
    const res = await login(PASSWORD);
    expect(res.status).toBe(204);
    const set = res.headers['set-cookie']?.[0] ?? '';
    expect(set).toMatch(/^bg_admin=[^;]+\./);
    const attrs = set.split(';').slice(1).map((a) => a.trim().toLowerCase());
    expect(attrs).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=strict', 'path=/', 'max-age=2592000']));
    expect(attrs.some((a) => a.startsWith('domain'))).toBe(false);
  });

  it('answers the admin API only with a valid session', async () => {
    expect((await call(base, ADMIN, 'GET', '/api/admin/summary')).status).toBe(401);
    expect((await call(base, ADMIN, 'GET', '/api/admin/summary', { cookie: 'bg_admin=forged.value' })).status).toBe(401);
    const cookie = cookieOf(await login(PASSWORD));
    store.recordVisit({ ts: now, visitor: 'k1', path: '/', source: 'reddit.com', subreddit: null, game: null, device: 'phone' });
    const res = await call(base, ADMIN, 'GET', '/api/admin/summary?range=7d', { cookie });
    expect(res.status).toBe(200);
    const summary = JSON.parse(res.text) as Summary;
    expect(summary.days).toHaveLength(7);
    expect(summary.totals.visitors).toBe(1);
    expect(summary.sources).toEqual([{ source: 'reddit.com', subreddit: null, visitors: 1 }]);
    expect((await call(base, ADMIN, 'GET', '/api/admin/summary?range=forever', { cookie })).status).toBe(400);
  });

  it('lists the open rooms', async () => {
    const cookie = cookieOf(await login(PASSWORD));
    const created = driver.create('scribble', 'Ann', AVATAR, 'conn-a');
    if (!created.ok) throw new Error('create failed');
    driver.join(created.seat.code, 'Bob', AVATAR, 'conn-b');
    now += 720_000;
    const res = await call(base, ADMIN, 'GET', '/api/admin/rooms', { cookie });
    expect(res.status).toBe(200);
    const { rooms } = JSON.parse(res.text) as LiveRoomsResponse;
    const room = rooms.find((r) => r.code === created.seat.code);
    expect(room).toMatchObject({ gameId: 'scribble', phase: 'lobby', connected: 2, seated: 2, spectators: 0 });
    expect(room!.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('saves the notice as plain text and serves it to the site at once', async () => {
    const cookie = cookieOf(await login(PASSWORD));
    const put = (body: unknown) => call(base, ADMIN, 'PUT', '/api/admin/notice', { body, cookie });
    expect((await put({ text: 'x'.repeat(141), on: true, expiresAt: null })).status).toBe(400);
    expect((await put({ text: '   ', on: true, expiresAt: null })).status).toBe(400);
    expect((await put({ text: 'Hi', on: 'yes', expiresAt: null })).status).toBe(400);
    expect((await put({ text: 'x'.repeat(140), on: true, expiresAt: null })).status).toBe(204);
    expect((await put({ text: '<script>x</script>', on: true, expiresAt: null })).status).toBe(204);
    const saved = JSON.parse((await call(base, ADMIN, 'GET', '/api/admin/notice', { cookie })).text);
    expect(saved.notice).toMatchObject({ text: '<script>x</script>', on: true, expiresAt: null, updatedAt: now });
    expect(JSON.parse((await call(base, SITE, 'GET', '/api/notice')).text)).toEqual({ text: '<script>x</script>' });
    expect((await put({ text: 'Off now', on: false, expiresAt: null })).status).toBe(204);
    expect(JSON.parse((await call(base, SITE, 'GET', '/api/notice')).text)).toEqual({});
  });

  it('signs out by clearing the cookie', async () => {
    const res = await call(base, ADMIN, 'POST', '/api/admin/logout');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^bg_admin=;.*Max-Age=0/i);
  });

  it('is invisible on the site host', async () => {
    const cookie = cookieOf(await login(PASSWORD));
    expect((await call(base, SITE, 'GET', '/api/admin/summary', { cookie })).status).toBe(404);
    expect((await call(base, SITE, 'POST', '/api/admin/login', { body: { password: PASSWORD } })).status).toBe(404);
    expect((await call(base, SITE, 'GET', '/admin')).status).toBe(404);
    expect((await call(base, SITE, 'GET', '/admin/index.html')).status).toBe(404);
    // The site's own API still answers there; the admin host answers nothing else.
    expect((await call(base, SITE, 'GET', '/api/notice')).status).toBe(200);
    expect((await call(base, ADMIN, 'GET', '/api/rooms/AB2K')).status).toBe(404);
  });
});
