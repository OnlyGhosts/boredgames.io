/**
 * The analytics store on disk: one SQLite file (Node's built-in node:sqlite, no native
 * dependency) on the Fly volume. Raw rows go to `visits` and `events`; each write also bumps the
 * day's counters in `daily` in the same transaction, which is what the dashboard reads.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { ukDay } from './analytics.js';
import { RAW_KEEP_MS, buildSummary, eventIncrements, spanDays, visitIncrements, type AnalyticsStore, type DailyCount, type EventRow, type Increment, type Notice, type Span, type Summary, type Visit } from './store.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS visits (
  ts INTEGER NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, path TEXT NOT NULL,
  source TEXT NOT NULL, subreddit TEXT, game TEXT, device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_day_visitor ON visits (day, visitor);
CREATE INDEX IF NOT EXISTS visits_ts ON visits (ts);
CREATE TABLE IF NOT EXISTS events (
  ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, game_id TEXT, players INTEGER, finished INTEGER
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL, metric TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL,
  PRIMARY KEY (day, metric, key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS peak (day TEXT PRIMARY KEY, players INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notice (
  id INTEGER PRIMARY KEY CHECK (id = 1), text TEXT NOT NULL, is_on INTEGER NOT NULL, expires_at INTEGER, updated_at INTEGER NOT NULL
);
`;

export class SqliteAnalyticsStore implements AnalyticsStore {
  private readonly db: DatabaseSync;
  private closed = false;
  private readonly sql: Record<
    | 'seenVisitor'
    | 'seenSource'
    | 'seenGame'
    | 'insertVisit'
    | 'insertEvent'
    | 'bump'
    | 'peak'
    | 'counts'
    | 'peaks'
    | 'getNotice'
    | 'setNotice'
    | 'clearNotice'
    | 'pruneVisits'
    | 'pruneEvents',
    StatementSync
  >;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;');
    this.db.exec(SCHEMA);
    const p = (sql: string) => this.db.prepare(sql);
    this.sql = {
      seenVisitor: p('SELECT 1 FROM visits WHERE day = ? AND visitor = ? LIMIT 1'),
      seenSource: p('SELECT 1 FROM visits WHERE day = ? AND visitor = ? AND source = ? AND subreddit IS ? LIMIT 1'),
      seenGame: p('SELECT 1 FROM visits WHERE day = ? AND visitor = ? AND game = ? LIMIT 1'),
      insertVisit: p('INSERT INTO visits (ts, day, visitor, path, source, subreddit, game, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      insertEvent: p('INSERT INTO events (ts, day, kind, game_id, players, finished) VALUES (?, ?, ?, ?, ?, ?)'),
      bump: p('INSERT INTO daily (day, metric, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (day, metric, key) DO UPDATE SET value = value + excluded.value'),
      peak: p('INSERT INTO peak (day, players) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET players = max(players, excluded.players)'),
      counts: p('SELECT day, metric, key, value FROM daily WHERE day >= ? AND day <= ?'),
      peaks: p('SELECT day, players FROM peak WHERE day >= ? AND day <= ?'),
      getNotice: p('SELECT text, is_on, expires_at, updated_at FROM notice WHERE id = 1'),
      setNotice: p(
        'INSERT INTO notice (id, text, is_on, expires_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET text = excluded.text, is_on = excluded.is_on, expires_at = excluded.expires_at, updated_at = excluded.updated_at',
      ),
      clearNotice: p('DELETE FROM notice WHERE id = 1'),
      pruneVisits: p('DELETE FROM visits WHERE ts < ?'),
      pruneEvents: p('DELETE FROM events WHERE ts < ?'),
    };
  }

  recordVisit(v: Visit): void {
    const day = ukDay(v.ts);
    this.transaction(() => {
      const first = {
        visitor: !this.sql.seenVisitor.get(day, v.visitor),
        source: !this.sql.seenSource.get(day, v.visitor, v.source, v.subreddit),
        game: v.game !== null && !this.sql.seenGame.get(day, v.visitor, v.game),
      };
      this.sql.insertVisit.run(v.ts, day, v.visitor, v.path, v.source, v.subreddit, v.game, v.device);
      this.bump(day, visitIncrements(v, first));
    });
  }

  recordEvent(e: EventRow): void {
    const day = ukDay(e.ts);
    this.transaction(() => {
      this.sql.insertEvent.run(e.ts, day, e.kind, e.gameId, e.players ?? null, e.finished === undefined ? null : Number(e.finished));
      this.bump(day, eventIncrements(e));
    });
  }

  notePlayersOnline(n: number, ts: number): void {
    this.sql.peak.run(ukDay(ts), n);
  }

  async summary(span: Span, now: number): Promise<Summary> {
    const days = spanDays(span, now);
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const counts = this.sql.counts.all(first, last) as unknown as DailyCount[];
    const peaks = new Map((this.sql.peaks.all(first, last) as Array<{ day: string; players: number }>).map((r) => [r.day, r.players]));
    return buildSummary(days, counts, peaks);
  }

  async getNotice(): Promise<Notice | null> {
    const row = this.sql.getNotice.get() as { text: string; is_on: number; expires_at: number | null; updated_at: number } | undefined;
    return row ? { text: row.text, on: row.is_on === 1, expiresAt: row.expires_at, updatedAt: row.updated_at } : null;
  }

  async setNotice(n: Notice | null): Promise<void> {
    if (n === null) this.sql.clearNotice.run();
    else this.sql.setNotice.run(n.text, Number(n.on), n.expiresAt, n.updatedAt);
  }

  async prune(now: number): Promise<void> {
    const cutoff = now - RAW_KEEP_MS;
    this.transaction(() => {
      this.sql.pruneVisits.run(cutoff);
      this.sql.pruneEvents.run(cutoff);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private bump(day: string, increments: Increment[]): void {
    for (const [metric, key, value] of increments) this.sql.bump.run(day, metric, key, value);
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
