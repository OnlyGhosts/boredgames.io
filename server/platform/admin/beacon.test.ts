import { describe, expect, it } from 'vitest';
import { KeyedRateLimiter } from '../rateLimiter.js';
import { DailySalt } from './analytics.js';
import { BEACON_MAX_BYTES, BEACON_PER_MINUTE, deviceOf, handleBeacon, type BeaconOptions, type BeaconRequest } from './beacon.js';
import { NoticeCache, publicNotice } from './notice.js';
import { MemoryAnalyticsStore } from './store.js';

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function setup(overrides: Partial<BeaconOptions> = {}) {
  const store = new MemoryAnalyticsStore();
  const salt = new DailySalt(() => NOW);
  const opts: BeaconOptions = { now: NOW, countHeadless: false, siteHosts: ['boredgames.io'], limiter: new KeyedRateLimiter(BEACON_PER_MINUTE, 60_000, 1000), ...overrides };
  const send = (body: unknown, req: Partial<BeaconRequest> = {}) =>
    handleBeacon({ body: typeof body === 'string' || body === null ? body : JSON.stringify(body), address: '198.51.100.1', userAgent: CHROME, network: 'net-1', ...req }, store, salt, opts);
  return { store, send, today: () => store.summary('today', NOW) };
}

const view = (extra: Record<string, unknown> = {}) => ({ k: 'view', path: '/', ref: null, game: null, w: 390, referrer: null, ...extra });

describe('deviceOf', () => {
  it('buckets the viewport width', () => {
    expect([deviceOf(320), deviceOf(759), deviceOf(760), deviceOf(1099), deviceOf(1100), deviceOf(2560)]).toEqual(['phone', 'phone', 'tablet', 'tablet', 'desktop', 'desktop']);
  });
});

describe('handleBeacon', () => {
  it('records a page view from Reddit with its subreddit', async () => {
    const { send, today } = setup();
    send(view({ referrer: 'https://www.reddit.com/r/WebGames/comments/abc/bored_games/' }));
    const s = await today();
    expect(s.totals).toMatchObject({ visitors: 1, views: 1 });
    expect(s.sources).toEqual([{ source: 'reddit.com', subreddit: 'r/WebGames', visitors: 1 }]);
  });

  it('files a ?ref= landing and a ?game= deep link by their words', async () => {
    const { send, today } = setup();
    send(view({ ref: 'SideProject', game: 'scribble' }));
    send(view({ ref: 'not a word!', game: 'no-such-game' }), { userAgent: `${CHROME} 2` });
    const s = await today();
    expect(s.sources).toEqual([
      { source: 'direct', subreddit: null, visitors: 1 },
      { source: 'ref:sideproject', subreddit: null, visitors: 1 },
    ]);
    expect(s.deepLinks).toEqual([{ game: 'scribble', visitors: 1 }]);
  });

  it('counts a join from the Wi-Fi list', async () => {
    const { send, today } = setup();
    send({ k: 'join', via: 'nearby' });
    expect((await today()).joinsNearby).toBe(1);
  });

  it('records nothing for a body over the cap, malformed JSON or an unknown shape', async () => {
    const { send, today } = setup();
    send(null);
    send('{"k":"view",');
    send('[]');
    send({ k: 'view' });
    send({ k: 'join', via: 'code' });
    send(view({ path: 'x'.repeat(BEACON_MAX_BYTES) }));
    expect((await today()).totals.views).toBe(0);
    expect((await today()).joinsNearby).toBe(0);
  });

  it('stops counting a network after 30 beacons in a minute', async () => {
    const { send, today } = setup();
    for (let i = 0; i < BEACON_PER_MINUTE + 5; i++) send(view());
    send(view(), { network: 'net-2' });
    expect((await today()).totals.views).toBe(BEACON_PER_MINUTE + 1);
  });

  it('skips crawlers, and headless browsers unless told to count them', async () => {
    const headless = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';
    const plain = setup();
    plain.send(view(), { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
    plain.send(view(), { userAgent: headless });
    expect((await plain.today()).totals.views).toBe(0);
    const e2e = setup({ countHeadless: true });
    e2e.send(view(), { userAgent: headless });
    expect((await e2e.today()).totals.views).toBe(1);
  });

  it('keeps room codes out of the stored path', async () => {
    const { store, send } = setup();
    send(view({ path: '/scribble/XK4P?x=1' }));
    send(view({ path: '/how-to-play' }));
    const held = JSON.stringify((store as unknown as { visits: unknown[] }).visits);
    expect(held).not.toContain('XK4P');
    expect(held).toContain('/how-to-play');
  });
});

describe('the public notice', () => {
  const notice = { text: 'Quick restart at 9pm', on: true, expiresAt: NOW + 60_000, updatedAt: NOW };

  it('is shown while on and unexpired, and never otherwise', () => {
    expect(publicNotice(notice, NOW)).toEqual({ text: 'Quick restart at 9pm' });
    expect(publicNotice({ ...notice, expiresAt: null }, NOW + 10 ** 9)).toEqual({ text: 'Quick restart at 9pm' });
    expect(publicNotice(notice, NOW + 60_000)).toEqual({});
    expect(publicNotice({ ...notice, on: false }, NOW)).toEqual({});
    expect(publicNotice(null, NOW)).toEqual({});
  });

  it('is read from the store at most every 30 seconds, unless invalidated', async () => {
    const store = new MemoryAnalyticsStore();
    let now = NOW;
    const cache = new NoticeCache(store, () => now);
    await store.setNotice(notice);
    expect(await cache.current()).toEqual({ text: 'Quick restart at 9pm' });
    await store.setNotice({ ...notice, text: 'Changed' });
    now += 29_000;
    expect(await cache.current()).toEqual({ text: 'Quick restart at 9pm' });
    now += 1_000;
    expect(await cache.current()).toEqual({ text: 'Changed' });
    await store.setNotice(null);
    cache.invalidate();
    expect(await cache.current()).toEqual({});
  });

  it('drops a cached notice the moment it expires', async () => {
    const store = new MemoryAnalyticsStore();
    let now = NOW;
    const cache = new NoticeCache(store, () => now);
    await store.setNotice({ ...notice, expiresAt: NOW + 10_000 });
    expect(await cache.current()).toEqual({ text: 'Quick restart at 9pm' });
    now += 10_000;
    expect(await cache.current()).toEqual({});
  });
});
