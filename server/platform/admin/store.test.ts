import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import type { EventRow, Visit } from '../../../shared/platform/admin.js';
import { visitorKey } from './analytics.js';
import { openStore } from './openStore.js';
import { SqliteAnalyticsStore } from './sqliteStore.js';
import { MemoryAnalyticsStore, type AnalyticsStore } from './store.js';

const dir = mkdtempSync(path.join(tmpdir(), 'bg-analytics-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let files = 0;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Three UK days (GMT, after the clock change): Mon 26, Tue 27 and Wed 28 Oct 2026. */
const D1 = Date.UTC(2026, 9, 26, 10, 0);
const D2 = Date.UTC(2026, 9, 27, 12, 0);
const D3 = Date.UTC(2026, 9, 28, 20, 0);
const NOW = Date.UTC(2026, 9, 28, 21, 0);

interface Backend {
  name: string;
  open(): { store: AnalyticsStore; reopen?: () => AnalyticsStore; strings: () => string[] };
}

/** Every string held anywhere inside a value: own fields, arrays, maps and sets. */
function stringsIn(value: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') out.push(value);
  if (value === null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (value instanceof Map) for (const [k, v] of value) stringsIn(v, stringsIn(k, out, seen), seen);
  else if (value instanceof Set || Array.isArray(value)) for (const v of value) stringsIn(v, out, seen);
  else for (const v of Object.values(value)) stringsIn(v, out, seen);
  return out;
}

/** Every value in every row of every table of a SQLite file. */
function stringsInDb(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.length).toBeGreaterThan(0);
    return tables.flatMap(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all().flatMap((row) => Object.values(row as Record<string, unknown>).map(String)));
  } finally {
    db.close();
  }
}

const BACKENDS: Backend[] = [
  {
    name: 'memory',
    open() {
      const store = new MemoryAnalyticsStore();
      return { store, strings: () => stringsIn(store) };
    },
  },
  {
    name: 'sqlite',
    open() {
      const file = path.join(dir, `a${++files}.db`);
      return { store: new SqliteAnalyticsStore(file), reopen: () => new SqliteAnalyticsStore(file), strings: () => stringsInDb(file) };
    },
  },
];

function visit(ts: number, visitor: string, overrides: Partial<Visit> = {}): Visit {
  return { ts, visitor, path: '/', source: 'direct', subreddit: null, game: null, device: 'phone', ...overrides };
}

function event(ts: number, kind: EventRow['kind'], gameId: string | null, extra: Partial<EventRow> = {}): EventRow {
  return { ts, kind, gameId, ...extra };
}

function seed(store: AnalyticsStore): void {
  const webgames = { source: 'reddit.com', subreddit: 'r/WebGames' };
  store.recordVisit(visit(D1, 'v1', webgames));
  store.recordVisit(visit(D1 + 60_000, 'v1', { ...webgames, path: '/scribble/AB2K' }));
  store.recordVisit(visit(D1, 'v2', { source: 'reddit.com', subreddit: null, game: 'scribble' }));
  store.recordVisit(visit(D2, 'v1'));
  store.recordVisit(visit(D2, 'v3', { device: 'desktop' }));
  store.recordVisit(visit(D3, 'v4', { source: 'ref:e2e', game: 'scribble' }));
  store.recordVisit(visit(D3, 'v5'));

  store.recordEvent(event(D1, 'room_created', 'scribble'));
  for (let i = 0; i < 3; i++) store.recordEvent(event(D1, 'player_joined', 'scribble'));
  store.recordEvent(event(D1, 'nearby_join', null));
  store.recordEvent(event(D1, 'game_started', 'scribble', { players: 3 }));
  store.recordEvent(event(D1, 'game_ended', 'scribble', { finished: true }));
  store.recordEvent(event(D3, 'room_created', 'poker'));
  for (let i = 0; i < 2; i++) store.recordEvent(event(D3, 'player_joined', 'poker'));
  store.recordEvent(event(D3, 'game_started', 'poker', { players: 2 }));
  store.recordEvent(event(D3, 'game_ended', 'poker', { finished: false }));

  store.notePlayersOnline(3, D1);
  store.notePlayersOnline(5, D3);
  store.notePlayersOnline(2, D3 + 1000);
}

describe.each(BACKENDS)('$name analytics store', (backend) => {
  it('adds up seven days: daily unique visitors, views and room activity', async () => {
    const { store } = backend.open();
    seed(store);
    const s = await store.summary('7d', NOW);
    expect(s.days.map((d) => d.day)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(s.days[4]).toEqual({ day: '2026-10-26', visitors: 2, views: 3, rooms: 1, players: 3, started: 1, finished: 1 });
    expect(s.days[5]).toEqual({ day: '2026-10-27', visitors: 2, views: 2, rooms: 0, players: 0, started: 0, finished: 0 });
    expect(s.totals).toEqual({ visitors: 6, views: 7, rooms: 2, players: 5, started: 2, finished: 1 });
    expect(s.avgPlayersPerRoom).toBe(2.5);
    await store.close();
  });

  it('counts a visitor once a day however many pages they load', async () => {
    const { store } = backend.open();
    for (let i = 0; i < 4; i++) store.recordVisit(visit(D3 + i, 'same'));
    store.recordVisit(visit(D3 - DAY_MS, 'same'));
    const today = await store.summary('today', NOW);
    expect(today.totals).toMatchObject({ visitors: 1, views: 4 });
    expect((await store.summary('7d', NOW)).totals).toMatchObject({ visitors: 2, views: 5 });
    await store.close();
  });

  it('keeps Reddit without a subreddit apart from r/WebGames, and lists deep links', async () => {
    const { store } = backend.open();
    seed(store);
    const s = await store.summary('7d', NOW);
    expect(s.sources).toEqual([
      { source: 'direct', subreddit: null, visitors: 3 },
      { source: 'reddit.com', subreddit: 'r/WebGames', visitors: 1 },
      { source: 'reddit.com', subreddit: null, visitors: 1 },
      { source: 'ref:e2e', subreddit: null, visitors: 1 },
    ]);
    expect(s.deepLinks).toEqual([{ game: 'scribble', visitors: 2 }]);
    await store.close();
  });

  it('reports games, joins from the Wi-Fi list against the rest, the peak and the busiest hour', async () => {
    const { store } = backend.open();
    seed(store);
    const s = await store.summary('7d', NOW);
    expect(s.games).toEqual([
      { gameId: 'scribble', started: 1, finished: 1, avgPlayers: 3 },
      { gameId: 'poker', started: 1, finished: 0, avgPlayers: 2 },
    ]);
    // Five seats taken in two rooms: two hosts, one from the Wi-Fi list, two by code.
    expect([s.joinsNearby, s.joinsCode]).toEqual([1, 2]);
    expect(s.peakPlayers).toBe(5);
    expect(s.busiestHour).toBe(10);
    const today = await store.summary('today', NOW);
    expect([today.peakPlayers, today.busiestHour, today.joinsNearby, today.joinsCode]).toEqual([5, 20, 0, 1]);
    await store.close();
  });

  it('files a game under the game that was played, not the one its room opened on', async () => {
    const { store } = backend.open();
    // A room opens on the default game (Scribble), two join, and the host switches to Blackjack and plays it.
    store.recordEvent(event(D3, 'room_created', 'scribble'));
    for (let i = 0; i < 2; i++) store.recordEvent(event(D3, 'player_joined', 'scribble'));
    store.recordEvent(event(D3, 'game_started', 'blackjack', { players: 2 }));
    store.recordEvent(event(D3, 'game_ended', 'blackjack', { finished: true }));
    const s = await store.summary('today', NOW);
    expect(s.games).toEqual([{ gameId: 'blackjack', started: 1, finished: 1, avgPlayers: 2 }]);
    expect(s.totals).toMatchObject({ rooms: 1, players: 2, started: 1, finished: 1 });
    await store.close();
  });

  it('summarises one UK day on its own', async () => {
    const { store } = backend.open();
    seed(store);
    const s = await store.summary({ day: '2026-10-26' }, NOW);
    expect(s.days).toEqual([{ day: '2026-10-26', visitors: 2, views: 3, rooms: 1, players: 3, started: 1, finished: 1 }]);
    expect(s.totals).toEqual({ visitors: 2, views: 3, rooms: 1, players: 3, started: 1, finished: 1 });
    expect(s.sources).toEqual([
      { source: 'reddit.com', subreddit: 'r/WebGames', visitors: 1 },
      { source: 'reddit.com', subreddit: null, visitors: 1 },
    ]);
    expect(s.games).toEqual([{ gameId: 'scribble', started: 1, finished: 1, avgPlayers: 3 }]);
    expect([s.joinsNearby, s.joinsCode, s.peakPlayers, s.busiestHour]).toEqual([1, 1, 3, 10]);
    // The same day asked for as today.
    expect(await store.summary({ day: '2026-10-28' }, NOW)).toEqual(await store.summary('today', NOW));
    await store.close();
  });

  it('answers a day before any data with zeros', async () => {
    const { store } = backend.open();
    seed(store);
    const s = await store.summary({ day: '2025-01-01' }, NOW);
    expect(s.days).toEqual([{ day: '2025-01-01', visitors: 0, views: 0, rooms: 0, players: 0, started: 0, finished: 0 }]);
    expect([s.sources, s.games, s.deepLinks, s.peakPlayers, s.busiestHour]).toEqual([[], [], [], 0, null]);
    await store.close();
  });

  it('answers an empty range with zeros and no busiest hour', async () => {
    const { store } = backend.open();
    const s = await store.summary('30d', NOW);
    expect(s.days).toHaveLength(30);
    expect(s.totals).toEqual({ visitors: 0, views: 0, rooms: 0, players: 0, started: 0, finished: 0 });
    expect([s.sources, s.games, s.deepLinks, s.peakPlayers, s.busiestHour, s.avgPlayersPerRoom, s.joinsCode]).toEqual([[], [], [], 0, null, 0, 0]);
    await store.close();
  });

  it('prunes raw rows after 90 days and keeps the daily totals', async () => {
    const { store, strings } = backend.open();
    const old = Date.UTC(2026, 6, 1, 12, 0);
    store.recordVisit(visit(old, 'old-visitor-key', { path: '/old-path' }));
    store.recordEvent(event(old, 'room_created', 'scribble'));
    store.recordVisit(visit(old + 85 * DAY_MS, 'recent-visitor-key'));
    await store.prune(old + 91 * DAY_MS);
    const held = strings();
    expect(held).not.toContain('old-visitor-key');
    expect(held).not.toContain('/old-path');
    expect(held).toContain('recent-visitor-key');
    expect((await store.summary('today', old)).totals).toMatchObject({ visitors: 1, views: 1, rooms: 1 });
    await store.close();
  });

  it('round-trips the notice and clears it', async () => {
    const { store } = backend.open();
    expect(await store.getNotice()).toBeNull();
    const notice = { text: 'Quick restart at 9pm <b>tonight</b>', on: true, expiresAt: NOW + 3600_000, updatedAt: NOW };
    await store.setNotice(notice);
    expect(await store.getNotice()).toEqual(notice);
    await store.setNotice({ ...notice, on: false, expiresAt: null });
    expect(await store.getNotice()).toEqual({ ...notice, on: false, expiresAt: null });
    await store.setNotice(null);
    expect(await store.getNotice()).toBeNull();
    await store.close();
  });

  it('never holds an address or a user agent', async () => {
    const { store, strings } = backend.open();
    const ip = '203.0.113.7';
    const ua = 'TestAgent/1.0';
    const salt = randomBytes(32);
    store.recordVisit(visit(D3, visitorKey(salt, ip, ua), { source: 'reddit.com', subreddit: 'r/WebGames', game: 'poker' }));
    store.recordEvent(event(D3, 'nearby_join', null));
    store.notePlayersOnline(1, D3);
    await store.setNotice({ text: 'Hello', on: true, expiresAt: null, updatedAt: D3 });
    const held = strings().join('\n');
    expect(held.length).toBeGreaterThan(0);
    expect(held).not.toContain(ip);
    expect(held).not.toContain('203.0.113');
    expect(held).not.toContain(ua);
    expect(held).not.toContain('TestAgent');
    await store.close();
  });

  if (backend.name === 'sqlite') {
    it('keeps everything across a close and a reopen', async () => {
      const opened = backend.open();
      seed(opened.store);
      await opened.store.setNotice({ text: 'Back soon', on: true, expiresAt: null, updatedAt: NOW });
      const before = await opened.store.summary('7d', NOW);
      await opened.store.close();
      const again = opened.reopen!();
      expect(await again.summary('7d', NOW)).toEqual(before);
      expect(await again.getNotice()).toEqual({ text: 'Back soon', on: true, expiresAt: null, updatedAt: NOW });
      // A visitor already counted today stays counted once after the reopen.
      again.recordVisit(visit(D3 + 5000, 'v5'));
      expect((await again.summary('today', NOW)).totals).toMatchObject({ visitors: 2, views: 3 });
      await again.close();
    });
  }
});

describe('openStore', () => {
  it('is file-backed when ANALYTICS_DB is set, and in memory otherwise', async () => {
    const memory = openStore({});
    expect(memory).toBeInstanceOf(MemoryAnalyticsStore);
    await memory.close();
    const file = path.join(dir, 'nested', 'dir', 'analytics.db');
    const sqlite = openStore({ ANALYTICS_DB: file });
    expect(sqlite).toBeInstanceOf(SqliteAnalyticsStore);
    await sqlite.close();
  });

  it('falls back to memory, with a warning, when the file cannot be opened', async () => {
    const logs: string[] = [];
    // A file where the directory should be: the volume is missing or mounted wrong.
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, '');
    const store = openStore({ ANALYTICS_DB: path.join(blocker, 'analytics.db') }, (m) => logs.push(m));
    expect(store).toBeInstanceOf(MemoryAnalyticsStore);
    expect(logs.join('\n')).toMatch(/analytics.*memory/i);
    await store.close();
  });
});
