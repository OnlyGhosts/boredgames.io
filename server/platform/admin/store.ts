/**
 * Where the admin analytics live. Raw visit and event rows are kept for 90 days; the daily
 * counters the dashboard reads are updated as each row is written and kept for good, so pruning
 * the raw rows never changes a total. Two backends share the counting and the summary below: an
 * in-memory one (development, tests, a server without its volume) and SQLite (sqliteStore.ts).
 */
import { shiftDay, type DayTotals, type EventRow, type Notice, type Range, type Summary, type Visit } from '../../../shared/platform/admin.js';
import { ukDay, ukHour } from './analytics.js';

export type { DayTotals, EventRow, Notice, Range, Summary, Visit } from '../../../shared/platform/admin.js';

export interface AnalyticsStore {
  recordVisit(v: Visit): void;
  recordEvent(e: EventRow): void;
  /** Players connected across every room at `ts`: the day's peak keeps the highest. */
  notePlayersOnline(n: number, ts: number): void;
  summary(span: Span, now: number): Promise<Summary>;
  getNotice(): Promise<Notice | null>;
  setNotice(n: Notice | null): Promise<void>;
  /** Drops raw rows older than RAW_KEEP_MS; the daily counters stay. */
  prune(now: number): Promise<void>;
  close(): Promise<void>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RAW_KEEP_MS = 90 * DAY_MS;

/** What a summary covers: a range of UK days ending today, or one UK day (YYYY-MM-DD, already checked). */
export type Span = Range | { day: string };

const RANGE_DAYS: Record<Range, number> = { today: 1, '7d': 7, '30d': 30 };

/** The UK days a span covers, oldest first: a range ends with today; a day is itself alone. */
export function spanDays(span: Span, now: number): string[] {
  if (typeof span !== 'string') return [span.day];
  const today = ukDay(now);
  const n = RANGE_DAYS[span];
  return Array.from({ length: n }, (_, i) => shiftDay(today, i - n + 1));
}

/** A daily counter: `metric` (views, source, game_started...) for `key` (a game, a source...) on a UK day. */
export interface DailyCount {
  day: string;
  metric: string;
  key: string;
  value: number;
}

export type Increment = [metric: string, key: string, value: number];

/** What a visit's subreddit is filed under next to its source. */
export function sourceKey(v: Pick<Visit, 'source' | 'subreddit'>): string {
  return `${v.source}\n${v.subreddit ?? ''}`;
}

/** Which of a visit's daily uniques it is the first of: the visitor, the visitor from this source, the visitor on this deep link. */
export interface FirstOfDay {
  visitor: boolean;
  source: boolean;
  game: boolean;
}

export function visitIncrements(v: Visit, first: FirstOfDay): Increment[] {
  const out: Increment[] = [['views', '', 1]];
  if (first.visitor) out.push(['visitors', '', 1]);
  if (first.source) out.push(['source', sourceKey(v), 1]);
  if (v.game !== null && first.game) out.push(['deeplink', v.game, 1]);
  return out;
}

export function eventIncrements(e: EventRow): Increment[] {
  const key = e.gameId ?? '';
  const out: Increment[] = [[e.kind, key, 1]];
  if (e.kind === 'game_started') out.push(['start_players', key, e.players ?? 0]);
  if (e.kind === 'game_ended' && e.finished) out.push(['game_finished', key, 1]);
  if (e.kind === 'player_joined') out.push(['join_hour', String(ukHour(e.ts)), 1]);
  return out;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The dashboard's summary of `days` from their counters and peaks. */
export function buildSummary(days: string[], counts: DailyCount[], peaks: Map<string, number>): Summary {
  const inRange = new Set(days);
  const rows = counts.filter((c) => inRange.has(c.day));
  const sum = (metric: string, filter: (c: DailyCount) => boolean = () => true) => rows.filter((c) => c.metric === metric && filter(c)).reduce((n, c) => n + c.value, 0);
  const byKey = (metric: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const c of rows) if (c.metric === metric) out.set(c.key, (out.get(c.key) ?? 0) + c.value);
    return out;
  };

  const dayTotals = (day: string): DayTotals => {
    const on = (c: DailyCount) => c.day === day;
    return {
      visitors: sum('visitors', on),
      views: sum('views', on),
      rooms: sum('room_created', on),
      players: sum('player_joined', on),
      started: sum('game_started', on),
      finished: sum('game_finished', on),
    };
  };
  const perDay = days.map((day) => ({ day, ...dayTotals(day) }));
  const totals: DayTotals = { visitors: 0, views: 0, rooms: 0, players: 0, started: 0, finished: 0 };
  for (const d of perDay) for (const k of Object.keys(totals) as Array<keyof DayTotals>) totals[k] += d[k];

  const sources = [...byKey('source')].map(([key, visitors]) => {
    const [source = '', subreddit = ''] = key.split('\n');
    return { source, subreddit: subreddit || null, visitors };
  });
  sources.sort((a, b) => b.visitors - a.visitors || a.source.localeCompare(b.source) || Number(a.subreddit === null) - Number(b.subreddit === null) || (a.subreddit ?? '').localeCompare(b.subreddit ?? ''));

  // Only a game's start and end name the game a party played: rooms and joins are filed under the
  // game a room opened on, the default one, before the host picks in the lobby (see Summary.games).
  const started = byKey('game_started');
  const finished = byKey('game_finished');
  const startPlayers = byKey('start_players');
  const gameIds = new Set([...started.keys(), ...byKey('game_ended').keys()]);
  gameIds.delete('');
  const games = [...gameIds].map((gameId) => {
    const s = started.get(gameId) ?? 0;
    return { gameId, started: s, finished: finished.get(gameId) ?? 0, avgPlayers: s ? round1((startPlayers.get(gameId) ?? 0) / s) : 0 };
  });
  games.sort((a, b) => b.started - a.started || b.finished - a.finished || a.gameId.localeCompare(b.gameId));

  const deepLinks = [...byKey('deeplink')].map(([game, visitors]) => ({ game, visitors }));
  deepLinks.sort((a, b) => b.visitors - a.visitors || a.game.localeCompare(b.game));

  const joinsNearby = sum('nearby_join');
  let busiestHour: number | null = null;
  let busiest = 0;
  for (const [hour, n] of byKey('join_hour')) {
    const h = Number(hour);
    if (n > busiest || (n === busiest && busiestHour !== null && h < busiestHour)) [busiest, busiestHour] = [n, h];
  }

  return {
    days: perDay,
    totals,
    sources,
    games,
    deepLinks,
    avgPlayersPerRoom: totals.rooms ? round1(totals.players / totals.rooms) : 0,
    joinsNearby,
    // Each room's host took the first seat without a code; everyone else came by the list or by code.
    joinsCode: Math.max(0, totals.players - totals.rooms - joinsNearby),
    peakPlayers: Math.max(0, ...days.map((d) => peaks.get(d) ?? 0)),
    busiestHour,
  };
}

/** Everything in this process's memory: gone on a restart. */
export class MemoryAnalyticsStore implements AnalyticsStore {
  private visits: Visit[] = [];
  private events: EventRow[] = [];
  /** day -> the visitor keys (and visitor+source, visitor+game pairs) already counted that day. */
  private readonly seen = new Map<string, Set<string>>();
  /** `day\tmetric\tkey` -> value. */
  private readonly counts = new Map<string, number>();
  private readonly peaks = new Map<string, number>();
  private notice: Notice | null = null;

  recordVisit(v: Visit): void {
    const day = ukDay(v.ts);
    let seen = this.seen.get(day);
    if (!seen) this.seen.set(day, (seen = new Set()));
    const firstOf = (key: string): boolean => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const first = { visitor: firstOf(`v\t${v.visitor}`), source: firstOf(`s\t${v.visitor}\t${sourceKey(v)}`), game: v.game !== null && firstOf(`g\t${v.visitor}\t${v.game}`) };
    this.visits.push({ ...v });
    this.add(day, visitIncrements(v, first));
  }

  recordEvent(e: EventRow): void {
    this.events.push({ ...e });
    this.add(ukDay(e.ts), eventIncrements(e));
  }

  notePlayersOnline(n: number, ts: number): void {
    const day = ukDay(ts);
    this.peaks.set(day, Math.max(this.peaks.get(day) ?? 0, n));
  }

  async summary(span: Span, now: number): Promise<Summary> {
    const counts = [...this.counts].map(([k, value]) => {
      const [day = '', metric = '', key = ''] = k.split('\t');
      return { day, metric, key, value };
    });
    return buildSummary(spanDays(span, now), counts, this.peaks);
  }

  async getNotice(): Promise<Notice | null> {
    return this.notice ? { ...this.notice } : null;
  }

  async setNotice(n: Notice | null): Promise<void> {
    this.notice = n ? { ...n } : null;
  }

  async prune(now: number): Promise<void> {
    const cutoff = now - RAW_KEEP_MS;
    this.visits = this.visits.filter((v) => v.ts >= cutoff);
    this.events = this.events.filter((e) => e.ts >= cutoff);
    const cutoffDay = ukDay(cutoff);
    for (const day of this.seen.keys()) if (day < cutoffDay) this.seen.delete(day);
  }

  async close(): Promise<void> {
    // Nothing to release.
  }

  private add(day: string, increments: Increment[]): void {
    for (const [metric, key, value] of increments) {
      const k = `${day}\t${metric}\t${key}`;
      this.counts.set(k, (this.counts.get(k) ?? 0) + value);
    }
  }
}
