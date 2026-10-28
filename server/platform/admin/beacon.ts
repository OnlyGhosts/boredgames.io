/**
 * The visit beacon (POST /api/v): one small text/plain JSON body per page load, or per join from
 * the same-Wi-Fi list. It always answers 204 and never errors to the client; anything too big,
 * malformed, from a crawler or past the per-network rate is simply not counted. The address and
 * user agent only feed the day's salted visitor key and are never stored.
 */
import { z } from 'zod';
import type { Device } from '../../../shared/platform/admin.js';
import { gameByFormerSlug, gameBySlug } from '../../../shared/platform/games.js';
import { isRoomPath } from '../../../shared/platform/roomCode.js';
import type { KeyedRateLimiter } from '../rateLimiter.js';
import { isBot, parseSource, visitorKey, type DailySalt } from './analytics.js';
import type { AnalyticsStore } from './store.js';

export const BEACON_PATH = '/api/v';
export const BEACON_MAX_BYTES = 2048;
export const BEACON_PER_MINUTE = 30;

const viewSchema = z.object({
  k: z.literal('view'),
  path: z.string().max(512),
  ref: z.string().max(64).nullable().optional(),
  game: z.string().max(64).nullable().optional(),
  w: z.number().finite().nonnegative().optional(),
  referrer: z.string().max(1024).nullable().optional(),
});
const joinSchema = z.object({ k: z.literal('join'), via: z.literal('nearby') });
const beaconSchema = z.discriminatedUnion('k', [viewSchema, joinSchema]);

/** What the route hands over: the body (null when it was over the cap) and who sent it. */
export interface BeaconRequest {
  body: string | null;
  /** The client's address, for the visitor key only. */
  address: string;
  userAgent: string;
  /** The salted network key the rate limit counts by. */
  network: string;
}

export interface BeaconOptions {
  now: number;
  countHeadless: boolean;
  /** The site's own hosts: a referrer from one of them is direct traffic. */
  siteHosts: string[];
  limiter: KeyedRateLimiter;
}

/** The viewport width as a device: under 760 a phone, under 1100 a tablet, a desktop otherwise. */
export function deviceOf(width: number): Device {
  if (width < 760) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desktop';
}

/** A `?ref=` value worth a label: one short word, lower-cased. */
function refWord(ref: string | null | undefined): string | null {
  return ref && /^[A-Za-z0-9_-]{1,32}$/.test(ref) ? ref.toLowerCase() : null;
}

/** A `?game=` value naming a game, as its current slug. */
function gameSlug(game: string | null | undefined): string | null {
  if (!game) return null;
  const slug = game.toLowerCase();
  return (gameBySlug(slug) ?? gameByFormerSlug(slug))?.slug ?? null;
}

/** The page's path without its query, and with a room's code taken out. */
function cleanPath(raw: string): string {
  const path = raw.split(/[?#]/)[0] ?? '/';
  if (!path.startsWith('/')) return '/';
  if (isRoomPath(path)) {
    const segments = path.split('/').filter(Boolean);
    return segments.length === 2 ? `/${segments[0]!.toLowerCase()}/:code` : '/:code';
  }
  return path.slice(0, 200);
}

/** Counts one beacon, or nothing. Never throws for anything a client can send. */
export function handleBeacon(req: BeaconRequest, store: AnalyticsStore, salt: DailySalt, opts: BeaconOptions): void {
  if (req.body === null || isBot(req.userAgent, opts.countHeadless)) return;
  if (!opts.limiter.tryAcquire(req.network, opts.now)) return;
  let json: unknown;
  try {
    json = JSON.parse(req.body);
  } catch {
    return;
  }
  const parsed = beaconSchema.safeParse(json);
  if (!parsed.success) return;
  const msg = parsed.data;
  if (msg.k === 'join') {
    store.recordEvent({ ts: opts.now, kind: 'nearby_join', gameId: null });
    return;
  }
  const { source, subreddit } = parseSource(msg.referrer ?? null, { ref: refWord(msg.ref) }, opts.siteHosts);
  store.recordVisit({
    ts: opts.now,
    visitor: visitorKey(salt.current(), req.address, req.userAgent),
    path: cleanPath(msg.path),
    source,
    subreddit,
    game: gameSlug(msg.game),
    device: deviceOf(msg.w ?? 0),
  });
}

/** Reads a request body up to `max` bytes: null when it was longer (the rest is drained and dropped). */
export function readCappedBody(req: NodeJS.ReadableStream, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer | string) => {
      if (over) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}
