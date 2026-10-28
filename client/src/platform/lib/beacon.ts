import { apiUrl } from '../net/server';

/**
 * The cookieless visit count (the admin dashboard): one small beacon per page load, and one when
 * someone joins a room from the same-Wi-Fi list. text/plain, so a cross-origin send needs no
 * preflight; it never throws and nothing waits on it, so the site works the same without it.
 */
export const BEACON_PATH = '/api/v';

export interface VisitPayload {
  k: 'view';
  path: string;
  /** The landing URL's `?ref=` word, if any. */
  ref: string | null;
  /** The landing URL's `?game=` deep link, if any. */
  game: string | null;
  /** The viewport width; the server keeps only phone, tablet or desktop. */
  w: number;
  referrer: string | null;
}

export function visitPayload(loc: Pick<Location, 'pathname' | 'search'>, referrer: string, width: number): VisitPayload {
  const params = new URLSearchParams(loc.search);
  return { k: 'view', path: loc.pathname, ref: params.get('ref'), game: params.get('game'), w: Math.round(width), referrer: referrer || null };
}

function send(payload: object): void {
  try {
    const json = JSON.stringify(payload);
    const url = apiUrl(BEACON_PATH);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator?.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([json], { type: 'text/plain' }))) return;
    } catch {
      // A blocked beacon falls back to fetch.
    }
    if (typeof fetch === 'function') {
      void fetch(url, { method: 'POST', body: json, headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' }).catch(() => undefined);
    }
  } catch {
    // Counting a visit is never worth an error.
  }
}

export function sendVisit(loc: Location, referrer: string, width: number): void {
  send(visitPayload(loc, referrer, width));
}

export function sendNearbyJoin(): void {
  send({ k: 'join', via: 'nearby' });
}
