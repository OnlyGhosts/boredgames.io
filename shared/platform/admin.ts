/**
 * What the admin dashboard and the game server share: the analytics rows the server stores, the
 * summary the dashboard draws, the site notice and the live-room list. Types only, so the admin UI
 * can import them without pulling in any server code.
 */

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
  /** Per game: rooms created, players joined, games started and finished, players per game started. */
  games: Array<{ gameId: string; rooms: number; players: number; started: number; finished: number; avgPlayers: number }>;
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
