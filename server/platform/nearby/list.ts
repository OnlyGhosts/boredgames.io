import { NEARBY_MAX_ROOMS, type NearbyRoom } from '../../../shared/platform/nearby.js';
import { findPlayer, isFull } from '../engine/players.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { GameDriver } from '../drivers/types.js';
import type { NearbyStore } from './store.js';

/** The card for a room still in its waiting room with a seat free, or null (started, ended, full). */
export function nearbyCardOf(data: PlatformRoomData | null, createdAt: number): NearbyRoom | null {
  if (!data || !waiting(data) || isFull(data)) return null;
  const host = findPlayer(data, data.hostId);
  if (!host) return null;
  return { code: data.code, gameId: data.gameId, host: { name: host.name, avatar: { ...host.avatar } }, players: data.players.length, createdAt };
}

/** Still waiting for its first game: a lobby showing results has played one. */
function waiting(data: PlatformRoomData): boolean {
  return data.phase === 'lobby' && data.results === null;
}

/**
 * The rooms on a network that can still be joined from the list, newest first. A room that has
 * started or gone leaves the list for good; one that is merely full stays, in case a seat frees.
 */
export async function listNearby(driver: GameDriver, store: NearbyStore, network: string, now: number): Promise<NearbyRoom[]> {
  const rooms: NearbyRoom[] = [];
  for (const entry of await store.list(network, now)) {
    if (rooms.length >= NEARBY_MAX_ROOMS) break;
    const data = await driver.roomData(entry.code);
    const card = nearbyCardOf(data, entry.createdAt);
    if (card) rooms.push(card);
    else if (!data || !waiting(data)) await store.remove(network, entry.code);
  }
  return rooms;
}
