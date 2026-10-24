import type { Avatar } from './avatar.js';
import type { GameId } from './games.js';

/** GET: the rooms created on the asker's network (same public address), newest first. Always HTTP 200. */
export const NEARBY_PATH = '/api/nearby';
/**
 * A room is listed while anyone is connected to it, however long that is. Its entry is only kept
 * this long without a room on the network being asked for (a room's own lifetime, ROOM_TTL_MS).
 */
export const NEARBY_KEEP_MS = 6 * 60 * 60 * 1000;
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
  /** A game is on: joining watches until the next round. */
  playing: boolean;
}

export interface NearbyResponse {
  rooms: NearbyRoom[];
  /** The server's clock, so the card's "2 min ago" does not depend on the phone's. */
  now: number;
}
