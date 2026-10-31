import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LiveRoom, Summary } from '@shared/platform/admin';
import { AnalyticsView } from './Analytics';
import { ageText, hourText, sourceLabel } from './format';
import { LoginView } from './Login';
import { NoticePreview, NoticeSwitch } from './Notice';
import { orderRooms, RoomCard, RoomsView } from './Rooms';
import { dayLabel, spanFromHash, spanHash } from './span';

const day = (d: string, visitors: number) => ({ day: d, visitors, views: visitors * 2, rooms: 1, players: 3, started: 1, finished: 1 });

const SUMMARY: Summary = {
  days: [day('2026-10-22', 4), day('2026-10-23', 0), day('2026-10-24', 9), day('2026-10-25', 2), day('2026-10-26', 7), day('2026-10-27', 1), day('2026-10-28', 12)],
  totals: { visitors: 35, views: 70, rooms: 7, players: 21, started: 7, finished: 6 },
  sources: [
    { source: 'reddit.com', subreddit: 'r/WebGames', visitors: 14 },
    { source: 'reddit.com', subreddit: null, visitors: 9 },
    { source: 'direct', subreddit: null, visitors: 8 },
    { source: 'ref:sideproject', subreddit: null, visitors: 3 },
    { source: 'news.ycombinator.com', subreddit: null, visitors: 1 },
  ],
  games: [
    { gameId: 'blackjack', started: 4, finished: 3, avgPlayers: 2.5 },
    { gameId: 'scribble', started: 3, finished: 3, avgPlayers: 3.2 },
  ],
  deepLinks: [{ game: 'scribble', visitors: 6 }],
  avgPlayersPerRoom: 3,
  joinsNearby: 4,
  joinsCode: 10,
  peakPlayers: 11,
  busiestHour: 20,
};

/** Wed 28 Oct 2026, 21:00 in London (GMT). */
const NOW = Date.UTC(2026, 9, 28, 21, 0);
const noop = () => undefined;

describe('the Analytics page', () => {
  const html = renderToStaticMarkup(<AnalyticsView summary={SUMMARY} span={{ range: '7d' }} now={NOW} onSpan={noop} />);

  it('names each source, Reddit by subreddit or as not given', () => {
    expect(html).toContain('r/WebGames');
    expect(html).toContain('Reddit (subreddit not given)');
    expect(html).toContain('?ref=sideproject');
    expect(html).toContain('news.ycombinator.com');
    expect(html).toContain('Direct');
  });

  it('shows the totals, the games, the deep links, the Wi-Fi joins and the busiest hour', () => {
    expect(html).toContain('35');
    expect(html).toContain('Scribble');
    // Each label keeps its last two words together, so a phone never leaves one alone on a line.
    expect(html).toContain('Joined by tapping the room on the same\u00a0Wi-Fi');
    expect(html).toContain('Average players per\u00a0room');
    expect(html).toContain('Typed the code');
    expect(html).toContain(hourText(20));
    expect(html).toContain('11');
  });

  it('draws one bar per day, each a button that opens its day', () => {
    const bars = html.match(/<button[^>]*data-testid="bar"[^>]*>/g) ?? [];
    expect(bars).toHaveLength(7);
    expect(bars[0]).toContain('aria-label="Show Thu 22 Oct"');
    expect(bars[0]).toContain('data-day="2026-10-22"');
    expect(bars[6]).toContain('aria-label="Show Wed 28 Oct"');
  });

  it('offers Day, 7 days and 30 days, with 7 days picked and no day stepper', () => {
    const tabs = [...html.matchAll(/data-testid="range-(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]);
    expect(tabs).toEqual([
      ['day', 'Day'],
      ['7d', '7 days'],
      ['30d', '30 days'],
    ]);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="range-7d"/);
    expect(html).not.toContain('data-testid="day-label"');
  });

  it('lists per game only what a game’s start tells: started, finished and players per game', () => {
    const games = html.slice(html.indexOf('data-testid="games"'), html.indexOf('data-testid="deep-links"'));
    const heads = [...games.matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(heads).toEqual(['Game', 'Started', 'Finished', 'Players per game']);
    const cells = [...games.matchAll(/<td[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(cells).toEqual(['Blackjack', '4', '3', '2.5', 'Scribble', '3', '3', '3.2']);
  });
});

describe('the Analytics page on one day', () => {
  const one: Summary = { ...SUMMARY, days: [day('2026-10-26', 7)] };

  it('steps between days: back always, forward only up to today', () => {
    const today = renderToStaticMarkup(<AnalyticsView summary={one} span={{ day: null }} now={NOW} onSpan={noop} />);
    expect(today).toMatch(/data-testid="day-label"[^>]*>Today</);
    expect(today).toMatch(/<button[^>]*disabled=""[^>]*data-testid="day-next"/);
    expect(today).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="day-prev"/);
    expect(today).toMatch(/aria-pressed="true"[^>]*data-testid="range-day"/);

    const monday = renderToStaticMarkup(<AnalyticsView summary={one} span={{ day: '2026-10-26' }} now={NOW} onSpan={noop} />);
    expect(monday).toMatch(/data-testid="day-label"[^>]*>Mon 26 Oct</);
    expect(monday).not.toMatch(/disabled=""/);
  });

  it('hides the chart and the table by day', () => {
    const html = renderToStaticMarkup(<AnalyticsView summary={one} span={{ day: '2026-10-26' }} now={NOW} onSpan={noop} />);
    expect(html).not.toContain('data-testid="bar"');
    expect(html).not.toContain('By day, as a table');
  });
});

describe('the day stepper’s label', () => {
  it('says Today, Yesterday, or the weekday and date', () => {
    expect(dayLabel('2026-10-28', NOW)).toBe('Today');
    expect(dayLabel('2026-10-27', NOW)).toBe('Yesterday');
    expect(dayLabel('2026-10-22', NOW)).toBe('Thu 22 Oct');
    // Another year says which.
    expect(dayLabel('2025-10-29', NOW)).toBe('Wed 29 Oct 2025');
  });

  it('follows London across the clock changes, not UTC', () => {
    // 23:30 UTC on Sat 24 Oct is 00:30 BST on Sun 25 Oct, the night the clocks go back.
    const autumn = Date.UTC(2026, 9, 24, 23, 30);
    expect(dayLabel('2026-10-25', autumn)).toBe('Today');
    expect(dayLabel('2026-10-24', autumn)).toBe('Yesterday');
    // Sunday 25 Oct lasts 25 hours: at 23:30 GMT it is still Sunday, and Saturday is yesterday.
    const longDay = Date.UTC(2026, 9, 25, 23, 30);
    expect(dayLabel('2026-10-25', longDay)).toBe('Today');
    expect(dayLabel('2026-10-24', longDay)).toBe('Yesterday');
    // 23:30 UTC on Sun 29 Mar is 00:30 BST on Mon 30 Mar; Sunday lasted 23 hours and is still yesterday.
    const spring = Date.UTC(2026, 2, 29, 23, 30);
    expect(dayLabel('2026-03-30', spring)).toBe('Today');
    expect(dayLabel('2026-03-29', spring)).toBe('Yesterday');
    expect(dayLabel('2026-03-28', spring)).toBe('Sat 28 Mar');
  });
});

describe('the Analytics address', () => {
  it('keeps the day or the range in the hash, so a reload keeps it', () => {
    expect(spanHash({ day: null })).toBe('#analytics');
    expect(spanHash({ day: '2026-10-26' })).toBe('#analytics/2026-10-26');
    expect(spanHash({ range: '30d' })).toBe('#analytics/30d');
    expect(spanFromHash('#analytics/2026-10-26', NOW)).toEqual({ day: '2026-10-26' });
    expect(spanFromHash('#analytics/7d', NOW)).toEqual({ range: '7d' });
    for (const today of ['', '#analytics', '#analytics/2026-10-28', '#analytics/2026-10-29', '#analytics/2026-02-30', '#analytics/soon', '#rooms'])
      expect(spanFromHash(today, NOW), today).toEqual({ day: null });
  });
});

describe('the notice preview', () => {
  it('shows markup as literal text', () => {
    const html = renderToStaticMarkup(<NoticePreview text={'<script>alert(1)</script> <a href="x">hi</a>'} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<a href');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('the Live rooms page', () => {
  const room = (code: string, over: Partial<LiveRoom> = {}): LiveRoom => ({ code, gameId: 'poker', phase: 'lobby', connected: 3, seated: 3, spectators: 0, ageMs: 60_000, ...over });

  it('shows a room as a card: its code on tiles, the game and its picture, the phase, the counts and its age', () => {
    const html = renderToStaticMarkup(<RoomCard room={room('XK4P', { phase: 'playing', connected: 4, seated: 3, spectators: 1, ageMs: 720_000 })} />);
    expect(html).toContain('data-code="XK4P"');
    expect(html.match(/class="room-card__char"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Room code X K 4 P"');
    expect(html).toContain('Poker');
    expect(html).toContain('data-art="poker"');
    expect(html).toMatch(/class="pill pill--accent[^"]*"[^>]*>Playing</);
    const stats = [...html.matchAll(/<dd>(\d+)<\/dd><dt>(\w+)<\/dt>/g)].map((m) => [m[1], m[2]]);
    expect(stats).toEqual([
      ['3', 'Players'],
      ['4', 'Connected'],
      ['1', 'Watching'],
    ]);
    expect(html).toContain('Open for 12\u00a0min');
    expect(html).not.toContain('away');
  });

  it('says a lobby is a lobby, and how many players are away', () => {
    const html = renderToStaticMarkup(<RoomCard room={room('AB2K', { connected: 1, seated: 3 })} />);
    expect(html).toMatch(/class="pill"[^>]*>In the lobby</);
    expect(html).toContain('2\u00a0away');
    // A finished game's results show over the lobby.
    expect(renderToStaticMarkup(<RoomCard room={room('AB2K', { phase: 'results' })} />)).toContain('In the lobby');
  });

  it('puts the rooms playing first, then the newest', () => {
    const rooms = [room('OLDL', { ageMs: 900_000 }), room('NEWL', { ageMs: 1000 }), room('OLDP', { phase: 'playing', ageMs: 800_000 }), room('NEWP', { phase: 'playing', ageMs: 5000 }), room('RSLT', { phase: 'results', ageMs: 2000 })];
    expect(orderRooms(rooms).map((r) => r.code)).toEqual(['NEWP', 'OLDP', 'NEWL', 'RSLT', 'OLDL']);
    const html = renderToStaticMarkup(<RoomsView rooms={rooms} />);
    expect([...html.matchAll(/data-testid="room-card" data-code="(\w+)"/g)].map((m) => m[1])).toEqual(['NEWP', 'OLDP', 'NEWL', 'RSLT', 'OLDL']);
  });

  it('says so, kindly, when no room is open', () => {
    const html = renderToStaticMarkup(<RoomsView rooms={[]} />);
    expect(html).toContain('No rooms are open right\u00a0now.');
    expect(html).toContain('updates every 5');
  });
});

describe('the notice switch', () => {
  it('is a plain switch: no words inside, its state in aria-checked', () => {
    for (const on of [true, false]) {
      const html = renderToStaticMarkup(<NoticeSwitch on={on} onToggle={noop} />);
      expect(html).toMatch(/^<button[^>]*role="switch"/);
      expect(html).toContain(`aria-checked="${on}"`);
      expect(html).toContain('aria-labelledby="notice-on-label"');
      expect(html).toContain('data-testid="notice-on"');
      // The site's switch: its track draws the knob (components.css).
      expect(html).toContain('<span class="switch__track" aria-hidden="true"></span>');
      expect(html.replace(/<[^>]+>/g, '')).toBe('');
    }
  });
});

describe('sign-in', () => {
  it('explains a wrong password and a wait', () => {
    expect(renderToStaticMarkup(<LoginView error={{ kind: 'wrong' }} busy={false} onSubmit={() => undefined} />)).toContain('Wrong password');
    expect(renderToStaticMarkup(<LoginView error={{ kind: 'wait', seconds: 8 }} busy={false} onSubmit={() => undefined} />)).toContain('Too many tries, wait 8 seconds');
  });
});

describe('formatting', () => {
  it('reads ages, hours and sources the way the owner says them', () => {
    expect(ageText(720_000)).toBe('12 min');
    expect(ageText(30_000)).toBe('under 1 min');
    expect(ageText(2 * 3600_000 + 5 * 60_000)).toBe('2 h 5 min');
    expect(hourText(0)).toBe('00:00 to 01:00');
    expect(hourText(23)).toBe('23:00 to 00:00');
    expect(sourceLabel('reddit.com', null)).toBe('Reddit (subreddit not given)');
    expect(sourceLabel('reddit.com', 'r/WebGames')).toBe('r/WebGames');
  });
});
