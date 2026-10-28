import { after as then, type MaybePromise } from '../drivers/types.js';
import type { PlatformRoomData } from '../engine/state.js';
import { roomEvents, ukDay } from './analytics.js';
import type { AnalyticsStore } from './store.js';

/**
 * The driver's room-change hook for the analytics: records the room events a change made and,
 * when the players connected across every room pass the day's peak so far, the new peak.
 */
export function roomChangeRecorder(
  store: AnalyticsStore,
  liveRooms: () => MaybePromise<PlatformRoomData[]>,
  now: () => number = () => Date.now(),
): (after: PlatformRoomData, before: PlatformRoomData | null) => void {
  let peak = { day: '', players: 0 };
  return (after, before) => {
    const ts = now();
    for (const e of roomEvents(before, after)) {
      store.recordEvent({
        ts,
        kind: e.kind,
        gameId: e.gameId,
        ...(e.kind === 'game_started' ? { players: e.players } : {}),
        ...(e.kind === 'game_ended' ? { finished: e.finished } : {}),
      });
    }
    const noted = then(liveRooms(), (rooms) => {
      let online = 0;
      for (const room of rooms) for (const p of room.players) if (p.connected) online++;
      const day = ukDay(ts);
      if (day === peak.day && online <= peak.players) return;
      peak = { day, players: online };
      store.notePlayersOnline(online, ts);
    });
    if (noted instanceof Promise) noted.catch(() => undefined);
  };
}
