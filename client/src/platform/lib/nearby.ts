import { useEffect, useState } from 'react';
import { avatarSchema } from '@shared/platform/avatar';
import { gameById, upgradeGameId } from '@shared/platform/games';
import { NEARBY_MAX_ROOMS, NEARBY_PATH, NEARBY_POLL_MS, type NearbyRoom } from '@shared/platform/nearby';
import { isValidRoomCode } from '@shared/platform/roomCode';
import { apiUrl } from '../net/server';

/** A room on the list with its age by the server's clock. */
export type NearbyCard = Omit<NearbyRoom, 'createdAt'> & { ageMs: number };

/** The answer as far as it is well formed: anything odd is left out, never shown half right. */
export function parseNearby(v: unknown): NearbyCard[] {
  if (typeof v !== 'object' || v === null) return [];
  const { rooms, now } = v as { rooms?: unknown; now?: unknown };
  if (!Array.isArray(rooms) || typeof now !== 'number') return [];
  const out: NearbyCard[] = [];
  for (const r of rooms as Array<Partial<Record<keyof NearbyRoom, unknown>>>) {
    const gameId = typeof r.gameId === 'string' ? upgradeGameId(r.gameId) : null;
    const host = r.host as { name?: unknown; avatar?: unknown } | undefined;
    const avatar = avatarSchema.safeParse(host?.avatar);
    if (typeof r.code !== 'string' || !isValidRoomCode(r.code) || !gameId || typeof host?.name !== 'string' || !avatar.success) continue;
    if (typeof r.players !== 'number' || typeof r.createdAt !== 'number') continue;
    out.push({ code: r.code, gameId, host: { name: host.name, avatar: avatar.data }, players: r.players, ageMs: Math.max(0, now - r.createdAt), playing: r.playing === true });
  }
  return out.slice(0, NEARBY_MAX_ROOMS);
}

/**
 * "Scribble · 3 players", plus "· playing now" while a game is on. Spaces inside a part don't
 * break, so on a narrow card the line wraps only at a dot and never cuts a word short.
 */
export function nearbyMeta(card: NearbyCard): string {
  const parts = [gameById(card.gameId).name, `${card.players} ${card.players === 1 ? 'player' : 'players'}`];
  if (card.playing) parts.push('playing now');
  return parts.map((part) => part.replace(/ /g, '\u00a0')).join(' · ');
}

/** "Jord’s room" (a name ending in s still takes ’s, as people say it). */
export function roomTitle(host: string): string {
  return `${host}’s room`;
}

/**
 * The rooms on this network, asked again every NEARBY_POLL_MS while the page is visible (and at
 * once when it comes back). Any failure shows nothing rather than an error.
 */
export function useNearbyRooms(enabled: boolean): NearbyCard[] {
  const [cards, setCards] = useState<NearbyCard[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;
    const load = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      const mine = (controller = new AbortController());
      try {
        const res = await fetch(apiUrl(NEARBY_PATH), { headers: { accept: 'application/json' }, signal: mine.signal });
        const next = res.ok ? parseNearby((await res.json()) as unknown) : [];
        if (!mine.signal.aborted) setCards(next);
      } catch {
        if (!mine.signal.aborted) setCards([]);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), NEARBY_POLL_MS);
    const onVisible = (): void => void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      controller?.abort();
    };
  }, [enabled]);
  return enabled ? cards : [];
}
