import { describe, expect, it } from 'vitest';
import { MemoryDriver } from '../drivers/memory.js';
import { AVATAR } from '../drivers/testUtils.js';
import { roomChangeRecorder } from './hooks.js';
import { MemoryAnalyticsStore } from './store.js';

const NOW = Date.UTC(2026, 9, 28, 19, 0);

describe('roomChangeRecorder', () => {
  it('records the rooms, joins and the peak of players online as the driver reports them', async () => {
    const store = new MemoryAnalyticsStore();
    let driver: MemoryDriver | null = null;
    driver = new MemoryDriver({ onRoomChange: roomChangeRecorder(store, () => driver!.liveRooms(), () => NOW) });
    const host = driver.create('scribble', 'Ann', AVATAR, 'a');
    if (!host.ok) throw new Error('create failed');
    driver.join(host.seat.code, 'Bob', AVATAR, 'b');
    driver.join(host.seat.code, 'Cat', AVATAR, 'c');
    driver.create('poker', 'Dan', AVATAR, 'd');
    driver.leave({ code: host.seat.code, playerId: host.seat.playerId });

    const s = await store.summary('today', NOW);
    expect(s.totals).toMatchObject({ rooms: 2, players: 4 });
    expect(s.games.map((g) => [g.gameId, g.rooms, g.players])).toEqual([
      ['scribble', 1, 3],
      ['poker', 1, 1],
    ]);
    expect(s.peakPlayers).toBe(4);
    expect(s.busiestHour).toBe(19);
    await driver.shutdown();
  });
});
