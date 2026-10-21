import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { homeHead, jsonLd, unknownHead } from '../client/src/platform/seo';
import { prerender, sitemapXml, withHead, withRoot } from './prerender';

const shell = readFileSync(fileURLToPath(new URL('../client/index.html', import.meta.url)), 'utf8');

describe('prerender', () => {
  it('puts the home head, structured data and markup into the shell', () => {
    const html = withRoot(withHead(shell, homeHead(), jsonLd()), '<main>front door</main>', '/');
    expect(html).toContain('<title>boredgames.io: party games for phones in the same room</title>');
    expect(html).toContain('<meta name="robots" content="index, follow"');
    expect(html).toContain('<link rel="canonical" href="https://boredgames.io/"');
    expect(html).toContain('<meta property="og:title" content="boredgames.io: party games for phones in the same room"');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('<div id="root" data-prerendered="/"><main>front door</main></div>');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)![1]) as { '@type': string }[];
    expect(ld.map((o) => o['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication']);
  });

  it('makes a 404 page that is noindex and not marked as prerendered', () => {
    const html = withRoot(withHead(shell, unknownHead(), null), '<main>x</main>', null);
    expect(html).toContain('<title>Page not found | boredgames.io</title>');
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain('<div id="root"><main>x</main></div>');
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('data-prerendered');
  });

  it('refuses a shell without the head elements it must fill', () => {
    expect(() => withHead('<html><head><title>x</title></head><body><div id="root"></div></body></html>', homeHead(), null)).toThrow(/meta\[name="description"\]/);
    expect(() => withRoot('<html><body></body></html>', '<main>x</main>', '/')).toThrow(/id="root"/);
  });

  it('lists the public routes in the sitemap with the build date', () => {
    expect(sitemapXml(['/'], '2026-10-21')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://boredgames.io/</loc><lastmod>2026-10-21</lastmod></url>\n</urlset>\n',
    );
  });

  it('writes the front door, the 404 page and the sitemap into the build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pre-'));
    writeFileSync(join(dir, 'index.html'), shell);
    prerender(dir, (path) => `<main data-path="${path}"><h1 class="sr-only">boredgames.io</h1><button data-testid="home-join">Join</button><button data-testid="home-create">Create a room</button></main>`, '2026-10-21');
    const index = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(index).toContain('<div id="root" data-prerendered="/"><main data-path="/">');
    expect(index).toContain('<meta name="robots" content="index, follow"');
    expect(index).toContain('application/ld+json');
    const notFound = readFileSync(join(dir, '404.html'), 'utf8');
    expect(notFound).toContain('<div id="root"><main data-path="/">');
    expect(notFound).toContain('<meta name="robots" content="noindex"');
    expect(notFound).not.toContain('application/ld+json');
    expect(readFileSync(join(dir, 'sitemap.xml'), 'utf8')).toBe(sitemapXml(['/'], '2026-10-21'));
  });

  it('refuses a home page that lost its front door', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pre-'));
    writeFileSync(join(dir, 'index.html'), shell);
    expect(() => prerender(dir, () => '<div>nothing</div>', '2026-10-21')).toThrow(/home-create/);
  });
});
