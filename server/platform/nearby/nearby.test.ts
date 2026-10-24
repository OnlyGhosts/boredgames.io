import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NEARBY_MAX_ROOMS, NEARBY_WINDOW_MS, type NearbyResponse } from '../../../shared/platform/nearby.js';
import { createApp, type App } from '../app.js';
import { MemoryDriver } from '../drivers/memory.js';
import type { GameDriver } from '../drivers/types.js';
import type { PlatformRoomData } from '../engine/state.js';
import { listNearby } from './list.js';
import { clientAddress, networkKey, networkOf } from './network.js';
import { MemoryNearbyStore } from './store.js';

const req = (headers: Record<string, string>, remoteAddress = '10.0.0.9'): IncomingMessage => ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

describe('the address a request came from', () => {
  it('prefers Fly-Client-IP, then x-real-ip, then the first x-forwarded-for hop, then the socket', () => {
    expect(clientAddress(req({ 'fly-client-ip': '203.0.113.1', 'x-forwarded-for': '198.51.100.2' }))).toBe('203.0.113.1');
    expect(clientAddress(req({ 'x-real-ip': '203.0.113.3', 'x-forwarded-for': '198.51.100.2' }))).toBe('203.0.113.3');
    expect(clientAddress(req({ 'x-forwarded-for': '198.51.100.2, 10.1.1.1' }))).toBe('198.51.100.2');
    expect(clientAddress(req({}, '::ffff:198.51.100.4'))).toBe('198.51.100.4');
    expect(clientAddress(req({ 'x-forwarded-for': 'nonsense' }))).toBe('10.0.0.9');
  });

  it('lists nothing for the machine itself, and puts every private address on one network', () => {
    expect(clientAddress(req({}, '::ffff:127.0.0.1'))).toBeNull();
    expect(clientAddress(req({}, '::1'))).toBeNull();
    expect(networkOf('192.168.1.20')).toBe(networkOf('10.0.0.3'));
    expect(networkOf('fd00::1')).toBe('private');
    expect(networkOf('172.32.0.1')).toBe('172.32.0.1');
  });

  it('groups IPv6 phones by their /64 and hashes the network with the salt', () => {
    expect(networkOf('2001:db8:1:2:aaaa::1')).toBe(networkOf('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(networkOf('2001:db8:1:2::1')).not.toBe(networkOf('2001:db8:1:3::1'));
    const key = networkKey('203.0.113.1', 'salt');
    expect(key).not.toContain('203');
    expect(key).toBe(networkKey('203.0.113.1', 'salt'));
    expect(key).not.toBe(networkKey('203.0.113.1', 'other'));
    expect(key).not.toBe(networkKey('203.0.113.2', 'salt'));
  });
});

/** A room as the list reads it: only the fields it looks at. */
function room(code: string, over: Partial<PlatformRoomData> = {}): PlatformRoomData {
  return {
    code,
    gameId: 'scribble',
    hostId: 'h',
    phase: 'lobby',
    results: null,
    players: [{ id: 'h', name: 'Jord', avatar: { emoji: 0, color: 0 } }],
    ...over,
  } as unknown as PlatformRoomData;
}

function driverWith(rooms: Map<string, PlatformRoomData>): GameDriver {
  return { roomData: (code: string) => rooms.get(code) ?? null } as unknown as GameDriver;
}

describe('listing rooms by network', () => {
  it('lists only rooms younger than 15 minutes, newest first, at most three', async () => {
    const store = new MemoryNearbyStore('s');
    const rooms = new Map(['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'].map((c) => [c, room(c)]));
    const t = 1_000_000_000;
    await store.add('net', 'AAAA', t - NEARBY_WINDOW_MS);
    await store.add('net', 'BBBB', t - 4000);
    await store.add('net', 'CCCC', t - 3000);
    await store.add('net', 'DDDD', t - 2000);
    await store.add('net', 'EEEE', t - 1000);
    const listed = await listNearby(driverWith(rooms), store, 'net', t);
    expect(listed.map((r) => r.code)).toEqual(['EEEE', 'DDDD', 'CCCC']);
    expect(listed).toHaveLength(NEARBY_MAX_ROOMS);
    expect(listed[0]).toEqual({ code: 'EEEE', gameId: 'scribble', host: { name: 'Jord', avatar: { emoji: 0, color: 0 } }, players: 1, createdAt: t - 1000 });
    expect(await listNearby(driverWith(rooms), store, 'elsewhere', t)).toEqual([]);
    // The expired entry is gone from the store, not only from the answer.
    expect((await store.list('net', t)).map((e) => e.code)).not.toContain('AAAA');
  });

  it('drops a room once its game starts, after a game, or when it is gone', async () => {
    const store = new MemoryNearbyStore('s');
    const rooms = new Map([
      ['PLAY', room('PLAY', { phase: 'playing' })],
      ['DONE', room('DONE', { results: {} as PlatformRoomData['results'] })],
      ['WAIT', room('WAIT')],
    ]);
    for (const code of ['PLAY', 'DONE', 'GONE', 'WAIT']) await store.add('net', code, 10);
    expect((await listNearby(driverWith(rooms), store, 'net', 20)).map((r) => r.code)).toEqual(['WAIT']);
    expect((await store.list('net', 20)).map((e) => e.code)).toEqual(['WAIT']);
    rooms.set('PLAY', room('PLAY'));
    expect((await listNearby(driverWith(rooms), store, 'net', 20)).map((r) => r.code)).toEqual(['WAIT']);
  });
});

describe('GET /api/nearby', () => {
  let app: App;
  let base = '';
  beforeAll(async () => {
    app = createApp({ driver: new MemoryDriver(), serveStatic: false });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    base = `127.0.0.1:${address.port}`;
  });
  afterAll(() => app.shutdown());

  const nearby = async (ip: string): Promise<{ raw: string; body: NearbyResponse }> => {
    const res = await fetch(`http://${base}/api/nearby`, { headers: { 'x-forwarded-for': ip } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const raw = await res.text();
    return { raw, body: JSON.parse(raw) as NearbyResponse };
  };

  it('shows a room to its own network only, and never an address', async () => {
    const ws = new WebSocket(`ws://${base}/ws`, { headers: { 'x-forwarded-for': '203.0.113.7' } });
    const welcome = new Promise<{ room: { code: string } }>((resolve) => ws.on('message', (d) => resolve(JSON.parse(String(d)) as { room: { code: string } })));
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(JSON.stringify({ t: 'create', gameId: 'scribble', name: 'Jord', avatar: { emoji: 1, color: 0 } }));
    const { room: created } = await welcome;
    let mine = await nearby('203.0.113.7');
    for (let i = 0; i < 20 && mine.body.rooms.length === 0; i++) mine = await nearby('203.0.113.7');
    expect(mine.body.rooms.map((r) => r.code)).toEqual([created.code]);
    expect(mine.body.rooms[0]?.host.name).toBe('Jord');
    expect(mine.raw).not.toContain('203.0.113');
    const other = await nearby('198.51.100.7');
    expect(other.body.rooms).toEqual([]);
    expect(other.raw).not.toContain('198.51.100');
    ws.close();
  });
});
