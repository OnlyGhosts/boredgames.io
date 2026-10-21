/**
 * What search engines and link previews read, in one place: every public route's head values and
 * the site's structured data. The app writes them into the head on each route change (lib/head.ts);
 * the build writes them into the prerendered front door, the 404 page and the sitemap
 * (scripts/prerender.ts). A new public page joins PUBLIC_ROUTES and gets its head here, and the
 * prerender, the sitemap and the tests pick it up at once. Nothing here is shown to a player.
 */
import { SITE_NAME, SITE_URL } from '@shared/platform/site';
import { roomTitle } from './lib/tabTitle';

export { SITE_URL };

/** The routes search engines may index: prerendered at build time and listed in the sitemap. */
export const PUBLIC_ROUTES: readonly string[] = ['/'];

export interface Head {
  title: string;
  description: string;
  /** Absolute: every page points at the front door until there is another public page. */
  canonical: string;
  robots: 'index, follow' | 'noindex, nofollow' | 'noindex';
  /** Absolute. */
  ogImage: string;
}

/**
 * The shape of router.ts's Route the head depends on. Structural rather than imported so that
 * the build script (checked without the DOM types) can use this module without the browser router.
 */
export type HeadRoute = { kind: 'home'; code: string | null } | { kind: 'game' } | { kind: 'unknown' };

const HOME_URL = `${SITE_URL}/`;
const HOME_TITLE = `${SITE_NAME}: party games for phones in the same room`;
const HOME_DESCRIPTION = 'Free party games for friends in the same room: drawing, who is the spy, comedy answers, blackjack and poker. One room code, a phone each, no app, no accounts.';
/** The share image until the 1200x630 card lands: then '/og.png' here and twitter:card summary_large_image in index.html. */
const OG_IMAGE = `${SITE_URL}/icons/icon-512.png`;

/** The front door: the one page in the index. */
export function homeHead(): Head {
  return { title: HOME_TITLE, description: HOME_DESCRIPTION, canonical: HOME_URL, robots: 'index, follow', ogImage: OG_IMAGE };
}

/** A room link ('/:slug/CODE', the legacy '/CODE', '/?room=CODE'): the tab title as today, never indexed, the front door's card. */
export function roomHead(code: string): Head {
  return { ...homeHead(), title: roomTitle(code), robots: 'noindex, nofollow' };
}

/** A path the app does not know: the app shows the front door with a note; crawlers get a 404 and no index entry. */
export function unknownHead(): Head {
  return { ...homeHead(), title: `Page not found | ${SITE_NAME}`, robots: 'noindex' };
}

/** The head for a route; a bare game slug redirects to the front door, so it carries the front door's head. */
export function headFor(route: HeadRoute): Head {
  if (route.kind === 'unknown') return unknownHead();
  if (route.kind === 'home' && route.code) return roomHead(route.code);
  return homeHead();
}

/**
 * The front door's structured data: who runs the site, the site, and the app it is. Nothing per
 * game, no FAQ, no HowTo: only what is on the page.
 */
export function jsonLd(): object[] {
  const context = 'https://schema.org';
  return [
    { '@context': context, '@type': 'Organization', name: SITE_NAME, url: HOME_URL, logo: OG_IMAGE },
    { '@context': context, '@type': 'WebSite', name: SITE_NAME, url: HOME_URL },
    {
      '@context': context,
      '@type': 'WebApplication',
      name: SITE_NAME,
      url: HOME_URL,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
    },
  ];
}
