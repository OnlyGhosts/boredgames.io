/**
 * The pure parts of the admin analytics: UK days and hours, the cookieless visitor key, where a
 * visit came from, bot filtering, and the room events read off two versions of a room. Nothing
 * here stores anything; the store (store.ts) gets only what these functions hand it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { GameId } from '../../../shared/platform/games.js';
import type { PlatformRoomData } from '../engine/state.js';

const UK_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const UK_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });

/** The UK calendar date of `ts` as YYYY-MM-DD (BST or GMT, whichever London is on). */
export function ukDay(ts: number): string {
  const parts = UK_DAY.formatToParts(ts);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The hour of the day in London, 0 to 23. */
export function ukHour(ts: number): number {
  const hour = UK_HOUR.formatToParts(ts).find((p) => p.type === 'hour')?.value ?? '0';
  return Number(hour) % 24;
}

/**
 * The salt visitor keys are hashed with: random, held in memory only, and replaced when the UK
 * date changes, so yesterday's keys cannot be linked to today's and a restart forgets it.
 */
export class DailySalt {
  private day = '';
  private salt: Buffer = Buffer.alloc(0);

  constructor(
    private readonly now: () => number,
    private readonly random: () => Buffer = () => randomBytes(32),
  ) {}

  current(): Buffer {
    const today = ukDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.salt = this.random();
    }
    return this.salt;
  }
}

/** A visitor for one UK day: a salted hash of address and user agent, neither of which is kept. */
export function visitorKey(salt: Buffer, ip: string, ua: string): string {
  return createHash('sha256').update(salt).update('\0').update(ip).update('\0').update(ua).digest('base64url').slice(0, 22);
}

export interface Source {
  /** 'direct', a referring host without www./old., or 'ref:<word>' from the landing URL. */
  source: string;
  /** For reddit.com, 'r/<name>' from the referrer's path; null when the referrer gave only the origin. */
  subreddit: string | null;
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^(www|old)\./, '');
}

/** Where a visit came from. A `?ref=` on the landing URL wins; the site's own hosts count as direct. */
export function parseSource(referrer: string | null, landing: { ref: string | null }, siteHosts: string[]): Source {
  if (landing.ref) return { source: `ref:${landing.ref}`, subreddit: null };
  if (!referrer) return { source: 'direct', subreddit: null };
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return { source: 'direct', subreddit: null };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { source: 'direct', subreddit: null };
  const host = bareHost(url.hostname);
  if (!host || siteHosts.some((h) => bareHost(h) === host)) return { source: 'direct', subreddit: null };
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const sub = /^\/r\/([A-Za-z0-9_]{2,32})(?:\/|$)/.exec(url.pathname);
    return { source: 'reddit.com', subreddit: sub ? `r/${sub[1]}` : null };
  }
  return { source: host, subreddit: null };
}

const BOT = /bot|crawl|spider|slurp|headless|prerender|lighthouse/i;
const HEADLESS_BROWSER = /HeadlessChrome/;

/** A crawler, a prerender or a headless browser; `countHeadless` lets the e2e suite's headless Chrome through. */
export function isBot(ua: string, countHeadless: boolean): boolean {
  const checked = countHeadless ? ua.replace(HEADLESS_BROWSER, 'Chrome') : ua;
  return BOT.test(checked);
}

export type RoomEvent =
  | { kind: 'room_created'; gameId: GameId }
  | { kind: 'player_joined'; gameId: GameId }
  | { kind: 'game_started'; gameId: GameId; players: number }
  | { kind: 'game_ended'; gameId: GameId; finished: boolean };

/** What happened between two versions of a room; `before` is null for a room's first change after it was created. */
export function roomEvents(before: PlatformRoomData | null, after: PlatformRoomData): RoomEvent[] {
  const gameId = after.gameId;
  const events: RoomEvent[] = [];
  if (before === null) events.push({ kind: 'room_created', gameId });
  const known = new Set(before?.players.map((p) => p.id) ?? []);
  for (const p of after.players) if (!known.has(p.id)) events.push({ kind: 'player_joined', gameId });
  const wasPlaying = before?.phase === 'playing';
  const isPlaying = after.phase === 'playing';
  if (!wasPlaying && isPlaying) events.push({ kind: 'game_started', gameId, players: after.players.filter((p) => p.participating).length });
  if (wasPlaying && !isPlaying) events.push({ kind: 'game_ended', gameId: before.gameId, finished: after.results !== null });
  return events;
}
