import { NEARBY_MAX_ROOMS, type NearbyRoom } from '../../../shared/platform/nearby.js';
import { connectedIds, findPlayer, isFull } from '../engine/players.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { GameDriver } from '../drivers/types.js';
import type { NearbyStore } from './store.js';

/** Someone is in the room: an empty one (all gone, or the host off to a new room) is off the list. */
function occupied(data: PlatformRoomData | null): data is PlatformRoomData {
  return data !== null && connectedIds(data).length > 0;
}

/** The card for an occupied room with a seat free, or null. */
export function nearbyCardOf(data: PlatformRoomData | null, createdAt: number): NearbyRoom | null {
  if (!occupied(data) || isFull(data)) return null;
  const host = findPlayer(data, data.hostId);
  if (!host) return null;
  return { code: data.code, gameId: data.gameId, host: { name: host.name, avatar: { ...host.avatar } }, players: data.players.length, createdAt, playing: data.phase === 'playing' };
}

/**
 * The rooms on a network someone is in, newest first. One found empty or gone leaves the list for
 * good; one that is merely full stays, in case a seat frees.
 */
export async function listNearby(driver: GameDriver, store: NearbyStore, network: string): Promise<NearbyRoom[]> {
  const rooms: NearbyRoom[] = [];
  for (const entry of await store.list(network)) {
    const data = await driver.roomData(entry.code);
    if (!occupied(data)) {
      await store.remove(network, entry.code);
      continue;
    }
    if (rooms.length >= NEARBY_MAX_ROOMS) continue;
    const card = nearbyCardOf(data, entry.createdAt);
    if (card) rooms.push(card);
  }
  return rooms;
}
