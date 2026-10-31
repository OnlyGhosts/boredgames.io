/**
 * What the admin dashboard and the game server share: the analytics rows the server stores, the
 * summary the dashboard draws, the site notice, the live-room list and the UK days both count in.
 * Types and pure date helpers only, so the admin UI can import them without pulling in any server code.
 */

const UK_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The UK calendar date of `ts` as YYYY-MM-DD (BST or GMT, whichever London is on). */
export function ukDay(ts: number): string {
  const parts = UK_DAY.formatToParts(ts);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A real calendar date written YYYY-MM-DD, and nothing else. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The YYYY-MM-DD day `by` days after (or, negative, before) `day`: calendar days, so a clock change never skips one. */
export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

export type Device = 'phone' | 'tablet' | 'desktop';

/** One page load. `visitor` is the day's salted key; no address or user agent is ever kept. */
export interface Visit {
  ts: number;
  visitor: string;
  path: string;
  source: string;
  subreddit: string | null;
  /** The `?game=` deep link the visit landed on, if any. */
  game: string | null;
  device: Device;
}

export type EventKind = 'room_created' | 'player_joined' | 'game_started' | 'game_ended' | 'nearby_join';

/** A room event, tied to no visitor. */
export interface EventRow {
  ts: number;
  kind: EventKind;
  gameId: string | null;
  /** game_started: how many play. */
  players?: number;
  /** game_ended: the game reached its results rather than being abandoned. */
  finished?: boolean;
}

/** The home page notice: plain text, on or off, with an optional expiry (epoch ms). */
export interface Notice {
  text: string;
  on: boolean;
  expiresAt: number | null;
  updatedAt: number;
}

export const NOTICE_MAX_LENGTH = 140;

export type Range = 'today' | '7d' | '30d';

export const RANGES: readonly Range[] = ['today', '7d', '30d'];

export interface DayTotals {
  /** Unique visitors (each UK day's own; a range adds the days up). */
  visitors: number;
  views: number;
  rooms: number;
  players: number;
  started: number;
  finished: number;
}

export interface Summary {
  /** Oldest first, one entry per UK day of the range. */
  days: Array<{ day: string } & DayTotals>;
  totals: DayTotals;
  /** Busiest first. Reddit rows carry the subreddit, or null when the referrer gave none. */
  sources: Array<{ source: string; subreddit: string | null; visitors: number }>;
  /**
   * Per game: games started and finished, and the average players a game started with. Rooms and
   * joins are not split by game: a room opens on the default game and its host picks another in
   * the lobby, so only a game's start says which game a party played.
   */
  games: Array<{ gameId: string; started: number; finished: number; avgPlayers: number }>;
  /** `?game=` landings, by game. */
  deepLinks: Array<{ game: string; visitors: number }>;
  /** Players joined per room created. */
  avgPlayersPerRoom: number;
  /** Joined by tapping a room in the same-Wi-Fi list. */
  joinsNearby: number;
  /** Joined any other way (a typed code or a link); hosts are not counted. */
  joinsCode: number;
  peakPlayers: number;
  /** The UK hour (0 to 23) with the most players joining, or null with none. */
  busiestHour: number | null;
}

/** One open room, as the Live rooms page lists it. */
export interface LiveRoom {
  code: string;
  gameId: string;
  phase: 'lobby' | 'playing' | 'results';
  connected: number;
  seated: number;
  spectators: number;
  ageMs: number;
}

export interface LiveRoomsResponse {
  rooms: LiveRoom[];
}
