import { describe, expect, it } from 'vitest';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { PUBLIC_ROUTES, headFor, homeHead, jsonLd } = await import('./seo');
const { parseRoute } = await import('./router');

describe('seo', () => {
  it('describes the home page within the limits search engines show', () => {
    const head = homeHead();
    expect(head.title).toBe('boredgames.io: party games for phones in the same room');
    expect(head.title.length).toBeLessThanOrEqual(60);
    expect(head.description).toBe('Free party games for friends in the same room: drawing, who is the spy, comedy answers, blackjack and poker. One room code, a phone each, no app, no accounts.');
    // Google shows about 160 characters of a description; a longer one is cut mid-sentence.
    expect(head.description.length).toBeLessThanOrEqual(160);
    expect(head.canonical).toBe('https://boredgames.io/');
    expect(head.robots).toBe('index, follow');
    expect(head.ogImage).toBe('https://boredgames.io/icons/icon-512.png');
  });

  it('keeps rooms and unknown paths out of the index, pointing at the front door', () => {
    expect(headFor(parseRoute('/scribble/MRAN'))).toMatchObject({ robots: 'noindex, nofollow', canonical: 'https://boredgames.io/', title: 'boredgames.io 🚪 𝗠𝗥𝗔𝗡' });
    expect(headFor(parseRoute('/MRAN'))).toMatchObject({ robots: 'noindex, nofollow' });
    expect(headFor(parseRoute('/nope/path'))).toMatchObject({ robots: 'noindex', title: 'Page not found | boredgames.io' });
    expect(headFor(parseRoute('/'))).toEqual(homeHead());
    // A bare game slug redirects to the front door: it describes the front door.
    expect(headFor(parseRoute('/scribble'))).toEqual(homeHead());
  });

  it('lists the public routes and names the site in structured data', () => {
    expect(PUBLIC_ROUTES).toEqual(['/']);
    const types = jsonLd().map((o) => (o as { '@type': string })['@type']);
    expect(types).toEqual(['Organization', 'WebSite', 'WebApplication']);
    const app = jsonLd()[2] as Record<string, unknown>;
    expect(app).toMatchObject({
      '@context': 'https://schema.org',
      name: 'boredgames.io',
      url: 'https://boredgames.io/',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
    });
    expect(jsonLd()[0]).toMatchObject({ '@type': 'Organization', name: 'boredgames.io', url: 'https://boredgames.io/', logo: 'https://boredgames.io/icons/icon-512.png' });
    expect(JSON.parse(JSON.stringify(jsonLd()))).toHaveLength(3);
  });
});
