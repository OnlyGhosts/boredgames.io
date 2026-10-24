import type { Avatar } from './avatar.js';
import type { GameId } from './games.js';

/** GET: the rooms created on the asker's network (same public address), newest first. Always HTTP 200. */
export const NEARBY_PATH = '/api/nearby';
/** A room is listed for at most this long after it was created. */
export const NEARBY_WINDOW_MS = 15 * 60 * 1000;
/** At most this many rooms are listed. */
export const NEARBY_MAX_ROOMS = 3;
/** How often an open home screen asks again. */
export const NEARBY_POLL_MS = 5000;

/** One room on the list: never an address, only what the card shows and the code to join. */
export interface NearbyRoom {
  code: string;
  gameId: GameId;
  host: { name: string; avatar: Avatar };
  players: number;
  createdAt: number;
}

export interface NearbyResponse {
  rooms: NearbyRoom[];
  /** The server's clock, so the card's "2 min ago" does not depend on the phone's. */
  now: number;
}
