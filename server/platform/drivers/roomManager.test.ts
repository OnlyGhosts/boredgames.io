import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import type { GameId } from '../../../shared/platform/games.js';
import { ROOM_CODE_LENGTH, isValidRoomCode } from '../../../shared/platform/roomCode.js';
import { roomEvents } from '../admin/analytics.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { Room } from './room.js';
import { MAX_ROOMS, RoomManager } from './roomManager.js';
import { AVATAR, FakeTransport } from './testUtils.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function manager(rng?: () => number, maxRooms?: number): { rooms: RoomManager; transport: FakeTransport } {
  const transport = new FakeTransport();
  const rooms = new RoomManager({ transport, clock: { now: () => Date.now() }, rng, maxRooms });
  return { rooms, transport };
}

function create(rooms: RoomManager, name: string, connectionId: string, gameId: GameId = 'scribble'): { room: Room; playerId: string } {
  const result = rooms.createRoom(gameId, name, AVATAR, connectionId);
  if (!result.ok) throw new Error(`createRoom failed: ${result.code}`);
  return result;
}

describe('RoomManager', () => {
  it('creates rooms with unique valid codes and seats the host', () => {
    const { rooms, transport } = manager();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { room, playerId } = create(rooms, `P${i}`, `c${i}`, i % 2 === 0 ? 'scribble' : 'template');
      expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(room.code)).toBe(true);
      expect(room.hostPlayerId).toBe(playerId);
      expect(transport.last(playerId, 'welcome').room.code).toBe(room.code);
      expect(transport.last(playerId, 'welcome').room.gameId).toBe(room.gameId);
      codes.add(room.code);
    }
    expect(codes.size).toBe(200);
    expect(rooms.stats()).toEqual({ rooms: 200, players: 200 });
  });

  it('retries on code collisions', () => {
    // Each code consumes four rng values: AAAA, AAAA (collision), SSSS.
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    const rng = vi.fn(() => values.shift() ?? 0.9);
    const { rooms } = manager(rng);
    expect(create(rooms, 'A', 'a').room.code).toBe('AAAA');
    expect(create(rooms, 'B', 'b').room.code).toBe('SSSS');
    expect(rng).toHaveBeenCalledTimes(12);
    expect(rooms.listCodes().sort()).toEqual(['AAAA', 'SSSS']);
  });

  it('normalizes lookups and distinguishes invalid from unknown codes', () => {
    const { rooms } = manager(() => 0);
    create(rooms, 'A', 'a'); // AAAA
    expect(rooms.lookup(' aa-aa ')).toMatchObject({ ok: true });
    expect(rooms.lookup('aaaa').ok).toBe(true);
    expect(rooms.lookup('https://host/aaaa').ok).toBe(false); // too much noise -> not a code
    expect(rooms.lookup('AB')).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(rooms.lookup('ABCO')).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(rooms.lookup('')).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(rooms.lookup('BBBB')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(rooms.get('AAAA')).toBeDefined();
  });

  it('deletes rooms that stay empty for EMPTY_ROOM_TTL_MS and keeps ones that refill', () => {
    const { rooms } = manager();
    const { room, playerId } = create(rooms, 'A', 'a');
    room.leave(playerId);
    expect(room.isEmpty).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS - 1);
    expect(rooms.get(room.code)).toBe(room);

    // Someone joins just in time: the deletion is cancelled.
    const joined = room.join('B', AVATAR, 'b');
    expect(joined.ok).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS * 2);
    expect(rooms.get(room.code)).toBe(room);
    expect(rooms.stats()).toEqual({ rooms: 1, players: 1 });

    if (joined.ok) room.leave(joined.playerId);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.get(room.code)).toBeUndefined();
    expect(rooms.stats()).toEqual({ rooms: 0, players: 0 });
    expect(rooms.lookup(room.code)).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    // A destroyed room refuses new seats.
    expect(room.join('C', AVATAR, 'c').ok).toBe(false);
  });

  it('counts players in their grace period as occupying the room', () => {
    const { rooms } = manager();
    const { room, playerId } = create(rooms, 'A', 'a');
    room.handleDisconnect(playerId);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    expect(rooms.get(room.code)).toBe(room);
    vi.advanceTimersByTime(1);
    expect(room.isEmpty).toBe(true);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it('refuses new rooms at the cap, counting abandoned rooms until their TTL frees them', () => {
    expect(MAX_ROOMS).toBeGreaterThan(0);
    const { rooms } = manager(undefined, 3);
    const first = create(rooms, 'A', 'a');
    create(rooms, 'B', 'b');
    create(rooms, 'C', 'c');
    expect(rooms.isAtCapacity).toBe(true);
    const refused = rooms.createRoom('scribble', 'D', AVATAR, 'd');
    expect(refused).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(rooms.stats()).toEqual({ rooms: 3, players: 3 });

    // An abandoned room still occupies a slot until it is deleted.
    first.room.leave(first.playerId);
    expect(rooms.createRoom('template', 'D', AVATAR, 'd').ok).toBe(false);
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS);
    expect(rooms.isAtCapacity).toBe(false);
    expect(create(rooms, 'D', 'd').room.code).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('destroy tears everything down', () => {
    const { rooms } = manager();
    const { room, playerId } = create(rooms, 'A', 'a');
    create(rooms, 'B', 'b');
    room.leave(playerId);
    rooms.destroy();
    expect(rooms.stats()).toEqual({ rooms: 0, players: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('RoomManager room changes (the admin analytics)', () => {
  function watched(): { rooms: RoomManager; changes: Array<{ after: PlatformRoomData; before: PlatformRoomData | null }> } {
    const changes: Array<{ after: PlatformRoomData; before: PlatformRoomData | null }> = [];
    const rooms = new RoomManager({ transport: new FakeTransport(), clock: { now: () => Date.now() }, onRoomChange: (after, before) => changes.push({ after, before }) });
    return { rooms, changes };
  }
  const eventsOf = (c: { after: PlatformRoomData; before: PlatformRoomData | null }) => roomEvents(c.before, c.after);

  it('reports a created room as new (no before), then each later change with its before', () => {
    const { rooms, changes } = watched();
    const { room } = create(rooms, 'Ann', 'a');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.before).toBeNull();
    expect(eventsOf(changes[0]!)).toEqual([
      { kind: 'room_created', gameId: 'scribble' },
      { kind: 'player_joined', gameId: 'scribble' },
    ]);
    room.join('Bob', AVATAR, 'b');
    expect(changes).toHaveLength(2);
    expect(changes[1]!.before).not.toBeNull();
    expect(eventsOf(changes[1]!)).toEqual([{ kind: 'player_joined', gameId: 'scribble' }]);
  });

  it('never reports a room brought back from a checkpoint as created', () => {
    const source = manager().rooms;
    const { room } = create(source, 'Ann', 'a');
    room.join('Bob', AVATAR, 'b');
    const stored = JSON.parse(JSON.stringify(room.state)) as PlatformRoomData;
    source.destroy();

    const { rooms, changes } = watched();
    const restored = rooms.restoreRoom(stored, Date.now());
    expect(restored).not.toBeNull();
    for (const p of stored.players) restored!.rejoin(p.token, `again-${p.id}`);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.before !== null)).toBe(true);
    expect(changes.flatMap(eventsOf)).toEqual([]);
  });

  it('lists the live rooms', () => {
    const { rooms } = watched();
    const a = create(rooms, 'Ann', 'a').room;
    const b = create(rooms, 'Bob', 'b', 'template').room;
    expect(rooms.liveRooms().map((r) => r.code).sort()).toEqual([a.code, b.code].sort());
    expect(rooms.liveRooms().find((r) => r.code === b.code)?.gameId).toBe('template');
  });

  it('keeps the room working when the analytics hook throws', () => {
    const logs: string[] = [];
    const rooms = new RoomManager({
      transport: new FakeTransport(),
      clock: { now: () => Date.now() },
      log: (m) => logs.push(m),
      onRoomChange: () => {
        throw new Error('analytics down');
      },
    });
    const { room } = create(rooms, 'Ann', 'a');
    expect(room.join('Bob', AVATAR, 'b').ok).toBe(true);
    expect(rooms.stats()).toEqual({ rooms: 1, players: 2 });
    expect(logs.join('\n')).toContain('analytics down');
  });
});
