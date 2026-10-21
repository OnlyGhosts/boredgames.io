import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
