import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryAnalyticsStore } from './admin/store.js';
import { createApp, type App } from './app.js';
import { MemoryDriver } from './drivers/memory.js';

/** The client build in a directory whose path contains a dot-directory segment (a `.claude/worktrees/...` checkout, say). */
const root = mkdtempSync(path.join(tmpdir(), 'bored-games-'));
const clientDir = path.join(root, '.hidden', 'dist', 'client');
const INDEX_HTML = '<!doctype html><title>Bored Games</title><div id="root"></div>';
const NOT_FOUND_HTML = '<!doctype html><meta name="robots" content="noindex"><title>Page not found</title><div id="root"></div>';
const ROBOTS_TXT = 'User-agent: *\nAllow: /\nSitemap: https://boredgames.io/sitemap.xml\n';

let app: App;
let baseUrl = '';

beforeAll(async () => {
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(path.join(clientDir, 'index.html'), INDEX_HTML);
  writeFileSync(path.join(clientDir, '404.html'), NOT_FOUND_HTML);
  writeFileSync(path.join(clientDir, 'robots.txt'), ROBOTS_TXT);
  writeFileSync(path.join(clientDir, 'app.js'), 'console.log("hi")');
  app = createApp({ driver: new MemoryDriver(), clientDir });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.shutdown();
  rmSync(root, { recursive: true, force: true });
});

describe('static client with an SPA fallback', () => {
  it('serves index.html for the front door and every room link, even from a checkout under a dot-directory', async () => {
    // '/skribble/AB2K' is an invite from before the Scribble rename (its pre-rename slug): the app rewrites it.
    for (const route of ['/', '/skribble/AB2K', '/template/AB2K', '/AB2K']) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status, route).toBe(200);
      expect(await res.text(), route).toBe(INDEX_HTML);
    }
    expect((await fetch(`${baseUrl}/scribble/AB2K`)).headers.get('cache-control')).toBe('no-cache');
  });

  it('serves assets as files and answers 404 for a missing asset or API path', async () => {
    expect(await (await fetch(`${baseUrl}/app.js`)).text()).toBe('console.log("hi")');
    expect((await fetch(`${baseUrl}/missing.png`)).status).toBe(404);
    const api = await fetch(`${baseUrl}/api/nope`);
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'not found' });
  });

  it('answers the health check and the room preview', async () => {
    expect(await (await fetch(`${baseUrl}/api/health`)).json()).toMatchObject({ ok: true });
    expect(await (await fetch(`${baseUrl}/api/rooms/AB2K`)).json()).toMatchObject({ exists: false });
  });

  it('lets a site on another origin read the API (the client on Vercel, the server on Fly)', async () => {
    const origin = 'https://theboredgames.vercel.app';
    const preview = await fetch(`${baseUrl}/api/rooms/AB2K`, { headers: { origin, accept: 'application/json' } });
    expect(preview.headers.get('access-control-allow-origin')).toBe('*');
    expect(await preview.json()).toMatchObject({ exists: false });

    const preflight = await fetch(`${baseUrl}/api/rooms/AB2K`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'accept' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');

    // Pages are not part of the API: no CORS header on the app itself.
    expect((await fetch(`${baseUrl}/scribble`, { headers: { origin } })).headers.get('access-control-allow-origin')).toBeNull();
  });
});

/** A request as the canonical site or as the Fly machine's own hostname: the Host header names the site (fetch would not let it be set). */
function asHost(host: string, route: string): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${baseUrl}${route}`, { headers: { host } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('crawlers', () => {
  it('serves room links with a noindex header and the shell', async () => {
    for (const route of ['/scribble/MRAN', '/SPYGAME/mran', '/Scribble/MRAN', '/skribble/MRAN', '/MRAN', '/mran']) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status, route).toBe(200);
      expect(res.headers.get('x-robots-tag'), route).toBe('noindex, nofollow');
      expect(await res.text(), route).toContain('id="root"');
    }
  });

  it('sends the old per-game landing pages to the front door, as Vercel does', async () => {
    for (const route of ['/scribble', '/SPYGAME', '/skribble']) {
      const res = await fetch(`${baseUrl}${route}`, { redirect: 'manual' });
      expect(res.status, route).toBe(308);
      expect(res.headers.get('location'), route).toBe('/');
    }
  });
  it('answers an unknown path with the 404 page and a 404 status', async () => {
    // A bare game slug (the old landing pages) and the pages of games the site never had are unknown too: the app redirects them.
    for (const route of ['/nope/path', '/hangman', '/battleships/MRAN', '/scribble/MRAN/extra', '/MRANX']) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status, route).toBe(404);
      expect(res.headers.get('cache-control'), route).toBe('no-cache');
      expect(await res.text(), route).toBe(NOT_FOUND_HTML);
    }
  });

  it('hides a copy of the site on any host but the canonical one', async () => {
    const fly = 'boredgames-io.fly.dev';
    expect((await asHost(fly, '/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
    expect((await asHost(fly, '/')).headers['x-robots-tag']).toBe('noindex');
    // A local run is the site itself: no copy to hide.
    expect((await asHost('localhost', '/')).headers['x-robots-tag']).toBeUndefined();
    expect((await asHost('localhost', '/robots.txt')).text).toContain('Allow: /');
    expect((await asHost(fly, '/scribble/MRAN')).headers['x-robots-tag']).toBe('noindex, nofollow');
    const site = await asHost('boredgames.io', '/robots.txt');
    expect([site.status, site.text]).toEqual([200, ROBOTS_TXT]);
    expect((await asHost('boredgames.io', '/')).headers['x-robots-tag']).toBeUndefined();
    expect((await asHost('boredgames.io', '/app.js')).headers['x-robots-tag']).toBeUndefined();
    expect((await asHost('boredgames.io', '/nope/path')).status).toBe(404);
  });
});

describe('visit beacons and the public notice', () => {
  const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const store = new MemoryAnalyticsStore();
  let now = Date.UTC(2026, 9, 28, 12, 0);
  let counted: App;
  let url = '';

  beforeAll(async () => {
    counted = createApp({ driver: new MemoryDriver(), serveStatic: false, analytics: store, now: () => now });
    await new Promise<void>((resolve) => counted.server.listen(0, '127.0.0.1', resolve));
    const address = counted.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await counted.shutdown();
  });

  const beacon = (body: string, from: string, ua = PHONE_UA) =>
    fetch(`${url}/api/v`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': ua, 'x-forwarded-for': from }, body });
  const view = (extra: Record<string, unknown> = {}) => JSON.stringify({ k: 'view', path: '/', ref: null, game: null, w: 390, referrer: null, ...extra });
  const views = async () => (await store.summary('today', now)).totals.views;

  it('records a page view from Reddit and answers 204', async () => {
    const res = await beacon(view({ referrer: 'https://www.reddit.com/r/WebGames/comments/x/y/', game: 'scribble' }), '198.51.100.20');
    expect(res.status).toBe(204);
    const s = await store.summary('today', now);
    expect(s.sources).toContainEqual({ source: 'reddit.com', subreddit: 'r/WebGames', visitors: 1 });
    expect(s.deepLinks).toEqual([{ game: 'scribble', visitors: 1 }]);
  });

  it('answers 204 and records nothing for 3 KB, malformed JSON or a crawler', async () => {
    const before = await views();
    const big = await beacon(view({ path: `/${'x'.repeat(3000)}` }), '198.51.100.21');
    expect(big.status).toBe(204);
    expect((await beacon('{"k":"view"', '198.51.100.21')).status).toBe(204);
    expect((await beacon(view(), '198.51.100.21', 'Googlebot/2.1')).status).toBe(204);
    expect(await views()).toBe(before);
  });

  it('answers 204 to a flood and stops recording past 30 a minute from one network', async () => {
    const before = await views();
    for (let i = 0; i < 31; i++) expect((await beacon(view(), '198.51.100.22')).status).toBe(204);
    expect(await views()).toBe(before + 30);
    now += 60_000;
    await beacon(view(), '198.51.100.22');
    expect(await views()).toBe(before + 31);
  });

  it('counts a join from the Wi-Fi list', async () => {
    const before = (await store.summary('today', now)).joinsNearby;
    expect((await beacon(JSON.stringify({ k: 'join', via: 'nearby' }), '198.51.100.23')).status).toBe(204);
    expect((await store.summary('today', now)).joinsNearby).toBe(before + 1);
  });

  it('never stores the address or the user agent', async () => {
    await beacon(view({ referrer: 'https://news.ycombinator.com/' }), '203.0.113.7', 'TestAgent/1.0');
    const held: string[] = [];
    const walk = (v: unknown, seen = new Set<unknown>()): void => {
      if (typeof v === 'string') held.push(v);
      if (v === null || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      const items = v instanceof Map ? [...v.keys(), ...v.values()] : v instanceof Set || Array.isArray(v) ? [...v] : Object.values(v);
      for (const item of items) walk(item, seen);
    };
    walk(store);
    expect(held.some((x) => x.includes('news.ycombinator.com'))).toBe(true);
    expect(held.join('\n')).not.toMatch(/203\.0\.113\.7|TestAgent/);
  });

  it('lets the site post a beacon from another origin, and only to /api/v', async () => {
    const origin = 'https://boredgames.io';
    const ask = (route: string) => fetch(`${url}${route}`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
    expect((await ask('/api/v')).headers.get('access-control-allow-methods')).toContain('POST');
    expect((await ask('/api/rooms/AB2K')).headers.get('access-control-allow-methods')).not.toContain('POST');
  });

  it('serves the notice only while it is on and unexpired, refreshed within 30 seconds', async () => {
    const notice = async () => (await fetch(`${url}/api/notice`)).json();
    await store.setNotice({ text: 'Quick restart at 9pm', on: true, expiresAt: now + 120_000, updatedAt: now });
    now += 30_000;
    expect(await notice()).toEqual({ text: 'Quick restart at 9pm' });
    await store.setNotice({ text: 'Quick restart at 9pm', on: false, expiresAt: null, updatedAt: now });
    expect(await notice()).toEqual({ text: 'Quick restart at 9pm' });
    now += 30_000;
    expect(await notice()).toEqual({});
    await store.setNotice({ text: 'Back at 10pm', on: true, expiresAt: now + 31_000, updatedAt: now });
    now += 30_000;
    expect(await notice()).toEqual({ text: 'Back at 10pm' });
    now += 1_000;
    expect(await notice()).toEqual({});
  });

  it('answers both without an analytics store (the Vercel function)', async () => {
    const res = await fetch(`${baseUrl}/api/v`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: view() });
    expect(res.status).toBe(204);
    expect(await (await fetch(`${baseUrl}/api/notice`)).json()).toEqual({});
  });
});
