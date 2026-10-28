import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LiveRoom, Summary } from '@shared/platform/admin';
import { AnalyticsView } from './Analytics';
import { ageText, hourText, sourceLabel } from './format';
import { LoginView } from './Login';
import { NoticePreview } from './Notice';
import { RoomsView } from './Rooms';

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
  games: [{ gameId: 'scribble', rooms: 5, players: 16, started: 5, finished: 4, avgPlayers: 3.2 }],
  deepLinks: [{ game: 'scribble', visitors: 6 }],
  avgPlayersPerRoom: 3,
  joinsNearby: 4,
  joinsCode: 10,
  peakPlayers: 11,
  busiestHour: 20,
};

describe('the Analytics page', () => {
  const html = renderToStaticMarkup(<AnalyticsView summary={SUMMARY} range="7d" onRange={() => undefined} />);

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

  it('draws one bar per day', () => {
    expect(html.match(/data-testid="bar"/g)).toHaveLength(7);
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
  it('lists each room with its game, phase, players and age', () => {
    const room: LiveRoom = { code: 'XK4P', gameId: 'poker', phase: 'playing', connected: 4, seated: 3, spectators: 1, ageMs: 720_000 };
    const html = renderToStaticMarkup(<RoomsView rooms={[room]} />);
    expect(html).toContain('XK4P');
    expect(html).toContain('Poker');
    expect(html).toContain('Playing');
    expect(html).toContain('12 min');
  });

  it('says so when no room is open', () => {
    expect(renderToStaticMarkup(<RoomsView rooms={[]} />)).toContain('No rooms are open right now.');
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
