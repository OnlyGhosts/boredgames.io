import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRoomData, type PlatformPlayerData, type PlatformRoomData } from '../engine/state.js';
import { DailySalt, isBot, parseSource, roomEvents, ukDay, ukHour, visitorKey } from './analytics.js';

const SITE = ['boredgames.io'];
const NO_REF = { ref: null };

describe('UK days and hours', () => {
  it('puts 00:30 BST on the UK date, not the UTC one', () => {
    // 24 Oct 23:30 UTC is 25 Oct 00:30 in London (still BST until the 25th's clock change).
    expect(ukDay(Date.UTC(2026, 9, 24, 23, 30))).toBe('2026-10-25');
    expect(ukHour(Date.UTC(2026, 9, 24, 23, 30))).toBe(0);
  });

  it('follows GMT after the clock change', () => {
    expect(ukDay(Date.UTC(2026, 9, 25, 23, 30))).toBe('2026-10-25');
    expect(ukHour(Date.UTC(2026, 9, 25, 23, 30))).toBe(23);
  });

  it('crosses into BST on 29 March', () => {
    expect(ukDay(Date.UTC(2026, 2, 28, 23, 30))).toBe('2026-03-28');
    expect(ukHour(Date.UTC(2026, 2, 29, 1, 30))).toBe(2);
    expect(ukDay(Date.UTC(2026, 2, 29, 23, 30))).toBe('2026-03-30');
  });
});

describe('DailySalt', () => {
  it('keeps one salt through a UK day and draws a new one when the UK date changes', () => {
    let now = Date.UTC(2026, 9, 28, 9, 0);
    const salt = new DailySalt(() => now, () => randomBytes(32));
    const morning = salt.current();
    now = Date.UTC(2026, 9, 28, 23, 59);
    expect(salt.current().equals(morning)).toBe(true);
    now = Date.UTC(2026, 9, 29, 0, 1);
    expect(salt.current().equals(morning)).toBe(false);
    expect(salt.current().length).toBe(32);
  });
});

describe('visitorKey', () => {
  const ip = '203.0.113.7';
  const ua = 'TestAgent/1.0';

  it('is 22 characters and stable for the same salt, address and agent', () => {
    const salt = randomBytes(32);
    const key = visitorKey(salt, ip, ua);
    expect(key).toHaveLength(22);
    expect(visitorKey(salt, ip, ua)).toBe(key);
    expect(visitorKey(salt, ip, 'Other/2.0')).not.toBe(key);
  });

  it('changes with the salt and never carries the address', () => {
    const key = visitorKey(randomBytes(32), ip, ua);
    expect(visitorKey(randomBytes(32), ip, ua)).not.toBe(key);
    expect(key).not.toContain(ip);
    expect(key).not.toContain('203');
  });
});

describe('parseSource', () => {
  it('takes the subreddit from a Reddit post link', () => {
    expect(parseSource('https://www.reddit.com/r/WebGames/comments/x/y/', NO_REF, SITE)).toEqual({ source: 'reddit.com', subreddit: 'r/WebGames' });
    expect(parseSource('https://old.reddit.com/r/playmygame/', NO_REF, SITE)).toEqual({ source: 'reddit.com', subreddit: 'r/playmygame' });
  });

  it('keeps Reddit when only its origin is sent (strict-origin referrer policy)', () => {
    expect(parseSource('https://www.reddit.com/', NO_REF, SITE)).toEqual({ source: 'reddit.com', subreddit: null });
  });

  it('counts the site itself and no referrer as direct', () => {
    expect(parseSource('https://boredgames.io/', NO_REF, SITE)).toEqual({ source: 'direct', subreddit: null });
    expect(parseSource('https://www.boredgames.io/scribble/AB2K', NO_REF, SITE)).toEqual({ source: 'direct', subreddit: null });
    expect(parseSource(null, NO_REF, SITE)).toEqual({ source: 'direct', subreddit: null });
    expect(parseSource('', NO_REF, SITE)).toEqual({ source: 'direct', subreddit: null });
    expect(parseSource('not a url', NO_REF, SITE)).toEqual({ source: 'direct', subreddit: null });
  });

  it('names any other site by its host', () => {
    expect(parseSource('https://news.ycombinator.com/item?id=1', NO_REF, SITE)).toEqual({ source: 'news.ycombinator.com', subreddit: null });
  });

  it('lets a ?ref= on the landing URL win as the label', () => {
    expect(parseSource('https://www.reddit.com/r/WebGames/', { ref: 'sideproject' }, SITE)).toEqual({ source: 'ref:sideproject', subreddit: null });
    expect(parseSource(null, { ref: 'sideproject' }, SITE)).toEqual({ source: 'ref:sideproject', subreddit: null });
  });
});

describe('isBot', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const headless = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';

  it('spots crawlers and lets browsers through', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', false)).toBe(true);
    expect(isBot('Some Spider 1.0', false)).toBe(true);
    expect(isBot(chrome, false)).toBe(false);
  });

  it('treats headless Chrome as a bot unless told to count it', () => {
    expect(isBot(headless, false)).toBe(true);
    expect(isBot(headless, true)).toBe(false);
    expect(isBot('Googlebot', true)).toBe(true);
  });
});

function player(id: string, joinOrder: number, overrides: Partial<PlatformPlayerData> = {}): PlatformPlayerData {
  return {
    id,
    token: `t-${id}`,
    name: id,
    avatar: { color: 0, face: 0 } as unknown as PlatformPlayerData['avatar'],
    score: 0,
    joinOrder,
    connected: true,
    connectionId: `c-${id}`,
    connectedAt: 0,
    disconnectedAt: null,
    ready: false,
    sittingOut: false,
    participating: false,
    ...overrides,
  };
}

function room(players: PlatformPlayerData[], overrides: Partial<PlatformRoomData> = {}): PlatformRoomData {
  return { ...createRoomData('AB2K', 'scribble', 0), players, hostId: players[0]?.id ?? '', ...overrides };
}

describe('roomEvents', () => {
  it('reports a new room with its host joining', () => {
    expect(roomEvents(null, room([player('a', 0)]))).toEqual([
      { kind: 'room_created', gameId: 'scribble' },
      { kind: 'player_joined', gameId: 'scribble' },
    ]);
  });

  it('reports each new player id', () => {
    const before = room([player('a', 0)]);
    expect(roomEvents(before, room([player('a', 0), player('b', 1), player('c', 2)]))).toEqual([
      { kind: 'player_joined', gameId: 'scribble' },
      { kind: 'player_joined', gameId: 'scribble' },
    ]);
  });

  it('reports a game starting with its player count', () => {
    const lobby = room([player('a', 0), player('b', 1), player('c', 2, { sittingOut: true })]);
    const playing = room([player('a', 0, { participating: true }), player('b', 1, { participating: true }), player('c', 2)], { phase: 'playing' });
    expect(roomEvents(lobby, playing)).toEqual([{ kind: 'game_started', gameId: 'scribble', players: 2 }]);
  });

  it('reports a game ending, finished when it left results', () => {
    const playing = room([player('a', 0, { participating: true })], { phase: 'playing' });
    const results = { id: 'r1', gameId: 'scribble' as const, reason: 'finished' as const, entries: [] };
    expect(roomEvents(playing, room([player('a', 0)], { results }))).toEqual([{ kind: 'game_ended', gameId: 'scribble', finished: true }]);
    expect(roomEvents(playing, room([player('a', 0)], { results: null }))).toEqual([{ kind: 'game_ended', gameId: 'scribble', finished: false }]);
  });

  it('reports nothing for a rejoin (same seats, a new connection)', () => {
    const before = room([player('a', 0), player('b', 1, { connected: false, connectionId: null })]);
    const after = room([player('a', 0), player('b', 1, { connectionId: 'c-b2' })]);
    expect(roomEvents(before, after)).toEqual([]);
  });
});
