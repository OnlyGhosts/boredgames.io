import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendNearbyJoin, sendVisit, visitPayload } from './beacon';

afterEach(() => {
  vi.unstubAllGlobals();
});

function at(url: string): Pick<Location, 'pathname' | 'search'> {
  const u = new URL(url);
  return { pathname: u.pathname, search: u.search };
}

/** Captures what navigator.sendBeacon was given. */
function stubBeacon(result = true): Array<{ url: string; body: Blob }> {
  const sent: Array<{ url: string; body: Blob }> = [];
  vi.stubGlobal('navigator', {
    sendBeacon: (url: string, body: Blob) => {
      sent.push({ url, body });
      return result;
    },
  });
  return sent;
}

describe('the visit beacon', () => {
  it('carries the path, the ?ref= and ?game= words, the width and the referrer', () => {
    expect(visitPayload(at('https://boredgames.io/?game=scribble&ref=sideproject'), 'https://www.reddit.com/r/WebGames/', 390.4)).toEqual({
      k: 'view',
      path: '/',
      ref: 'sideproject',
      game: 'scribble',
      w: 390,
      referrer: 'https://www.reddit.com/r/WebGames/',
    });
    expect(visitPayload(at('https://boredgames.io/scribble/XK4P'), '', 1280)).toEqual({ k: 'view', path: '/scribble/XK4P', ref: null, game: null, w: 1280, referrer: null });
  });

  it('goes out as a text/plain beacon to /api/v', async () => {
    const sent = stubBeacon();
    sendVisit(at('https://boredgames.io/?game=scribble&ref=sideproject') as Location, '', 800);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/v');
    expect(sent[0]!.body.type).toBe('text/plain');
    expect(JSON.parse(await sent[0]!.body.text())).toMatchObject({ k: 'view', game: 'scribble', ref: 'sideproject', w: 800 });
  });

  it('says when someone joins from the same-Wi-Fi list', async () => {
    const sent = stubBeacon();
    sendNearbyJoin();
    expect(JSON.parse(await sent[0]!.body.text())).toEqual({ k: 'join', via: 'nearby' });
  });

  it('falls back to a keepalive fetch, and never throws', () => {
    const fetches: Array<[string, RequestInit]> = [];
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      fetches.push([url, init]);
      return Promise.reject(new Error('offline'));
    });
    expect(() => sendNearbyJoin()).not.toThrow();
    expect(fetches).toHaveLength(1);
    expect(fetches[0]![1]).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });

    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('no fetch either');
    });
    expect(() => sendVisit(at('https://boredgames.io/') as Location, '', 390)).not.toThrow();
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('fetch', undefined);
    expect(() => sendNearbyJoin()).not.toThrow();
  });
});
