import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (file: string) => fileURLToPath(new URL(`../${file}`, import.meta.url));
const cfg = JSON.parse(readFileSync(root('vercel.json'), 'utf8')) as {
  trailingSlash: boolean;
  headers: { source: string; headers: { key: string; value: string }[] }[];
  rewrites: { source: string; destination: string }[];
  redirects: { source: string; destination: string; permanent: boolean }[];
};
const ROOM = '/:slug(scribble|skribble|spygame|quipgame|blackjack|poker|template)/:code([A-Za-z0-9]{4})';
const BARE = '/:code([A-Za-z0-9]{4})';

describe('vercel.json', () => {
  it('serves one URL per page and caches hashed assets for a year', () => {
    expect(cfg.trailingSlash).toBe(false);
    expect(cfg.headers).toContainEqual({ source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] });
    expect(cfg.headers).toContainEqual({ source: '/version.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] });
  });

  it('marks room links noindex and rewrites only room links to the app', () => {
    for (const source of [ROOM, BARE]) {
      expect(cfg.rewrites).toContainEqual({ source, destination: '/index.html' });
      expect(cfg.headers).toContainEqual({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] });
    }
    expect(cfg.rewrites.map((r) => r.source)).toEqual(['/ws', '/api/(.*)', ROOM, BARE]);
  });

  it('redirects the old game paths and index.html to the front door', () => {
    expect(cfg.redirects).toContainEqual({ source: '/index.html', destination: '/', permanent: true });
    expect(cfg.redirects).toContainEqual({ source: '/(scribble|skribble|spygame|quipgame|blackjack|poker|template)', destination: '/', permanent: true });
  });

  it('ships robots.txt and the IndexNow key', () => {
    expect(readFileSync(root('client/public/robots.txt'), 'utf8')).toBe('User-agent: *\nAllow: /\nSitemap: https://boredgames.io/sitemap.xml\n');
    const keys = readdirSync(root('client/public')).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
    expect(keys).toHaveLength(1);
    expect(readFileSync(root(`client/public/${keys[0]}`), 'utf8').trim()).toBe(keys[0].replace('.txt', ''));
  });
});
