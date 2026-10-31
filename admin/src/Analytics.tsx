import { useCallback, useEffect, useState } from 'react';
import { shiftDay, ukDay, type Summary } from '@shared/platform/admin';
import { Icon } from '../../client/src/platform/components/Icons';
import { fetchSummary, SignedOut } from './api';
import { BarChart } from './BarChart';
import { gameName, hourText, noOrphan, num, sourceLabel } from './format';
import { dayLabel, daySpan, isDaySpan, spanDay, spanFromHash, spanHasToday, spanHash, spanQuery, type Span } from './span';

type Mode = 'day' | '7d' | '30d';
const MODES: Array<{ mode: Mode; label: string; span: Span }> = [
  { mode: 'day', label: 'Day', span: { day: null } },
  { mode: '7d', label: '7 days', span: { range: '7d' } },
  { mode: '30d', label: '30 days', span: { range: '30d' } },
];
const modeOf = (span: Span): Mode => (isDaySpan(span) ? 'day' : span.range);

interface ViewProps {
  summary: Summary;
  span: Span;
  /** The clock the day labels read (Date.now() on the page). */
  now: number;
  onSpan(span: Span): void;
  /** The summary shown is the last span's while this one loads. */
  busy?: boolean;
}

/** Day, 7 days or 30 days; in Day mode, the day it shows with a step back and a step forward (never past today). */
export function SpanControls({ span, now, onSpan }: Pick<ViewProps, 'span' | 'now' | 'onSpan'>) {
  const day = spanDay(span, now);
  const today = ukDay(now);
  return (
    <div className="span-bar">
      <div className="segmented" role="group" aria-label="Range">
        {MODES.map((m) => (
          <button key={m.mode} type="button" className="segmented__item" aria-pressed={m.mode === modeOf(span)} onClick={() => onSpan(m.span)} data-testid={`range-${m.mode}`}>
            {m.label}
          </button>
        ))}
      </div>
      {day !== null && (
        <div className="stepper" role="group" aria-label="Day">
          <button type="button" className="stepper__btn" aria-label="The day before" onClick={() => onSpan(daySpan(shiftDay(day, -1), now))} data-testid="day-prev">
            <Icon paths="m15 6-6 6 6 6" size={20} />
          </button>
          <span className="stepper__label" aria-live="polite" data-testid="day-label">
            {dayLabel(day, now)}
          </span>
          <button type="button" className="stepper__btn" aria-label="The day after" disabled={day >= today} onClick={() => onSpan(daySpan(shiftDay(day, 1), now))} data-testid="day-next">
            <Icon paths="m9 6 6 6-6 6" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="tile" data-testid={testId}>
      <span className="tile__value">{num(value)}</span>
      <span className="tile__label">{label}</span>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="empty">{children}</p>;
}

export function AnalyticsView({ summary, span, now, onSpan, busy = false }: ViewProps) {
  const { totals } = summary;
  const byDay = !isDaySpan(span) && summary.days.length > 1;
  const within = isDaySpan(span) ? 'on this day' : 'in this range';
  return (
    <div className="page" data-testid="analytics" aria-busy={busy}>
      <SpanControls span={span} now={now} onSpan={onSpan} />

      <div className={`page analytics__body${busy ? ' is-busy' : ''}`}>
        <section className="tiles" aria-label="Totals">
          <Tile label="Visitors" value={totals.visitors} testId="tile-visitors" />
          <Tile label="Page views" value={totals.views} testId="tile-views" />
          <Tile label="Rooms created" value={totals.rooms} testId="tile-rooms" />
          <Tile label="Players joined" value={totals.players} testId="tile-players" />
          <Tile label="Games started" value={totals.started} testId="tile-started" />
          <Tile label="Games finished" value={totals.finished} testId="tile-finished" />
        </section>

        {byDay && (
          <section className="card section">
            <h2 className="section__title">Visitors by day</h2>
            <BarChart days={summary.days.map((d) => ({ day: d.day, value: d.visitors }))} unit="visitors" onPick={(day) => onSpan(daySpan(day, now))} />
          </section>
        )}

        <div className="grid">
          <section className="card section" data-testid="sources">
            <h2 className="section__title">Sources</h2>
            {summary.sources.length === 0 ? (
              <Empty>{noOrphan(`No visits ${within}.`)}</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col" className="num">
                      Visitors
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.sources.map((s) => (
                    <tr key={`${s.source}\n${s.subreddit ?? ''}`} data-testid="source-row">
                      <td>{sourceLabel(s.source, s.subreddit)}</td>
                      <td className="num">{num(s.visitors)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card section" data-testid="joins">
            <h2 className="section__title">Rooms and players</h2>
            <dl className="facts">
              {[
                { label: 'Joined by tapping the room on the same Wi-Fi', value: num(summary.joinsNearby), testId: 'joins-nearby' },
                { label: 'Typed the code or opened a link', value: num(summary.joinsCode), testId: 'joins-code' },
                { label: 'Average players per room', value: summary.avgPlayersPerRoom.toLocaleString('en-GB') },
                { label: 'Most players online at once', value: num(summary.peakPlayers), testId: 'peak-players' },
                { label: 'Busiest hour for joining (UK time)', value: summary.busiestHour === null ? 'None yet' : hourText(summary.busiestHour) },
              ].map((fact) => (
                <div key={fact.label}>
                  <dt>{noOrphan(fact.label)}</dt>
                  <dd data-testid={fact.testId}>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card section" data-testid="games">
            <h2 className="section__title">Games</h2>
            {summary.games.length === 0 ? (
              <Empty>{noOrphan(`No games started ${within}.`)}</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Game</th>
                    <th scope="col" className="num">Started</th>
                    <th scope="col" className="num">Finished</th>
                    <th scope="col" className="num">Players per game</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.games.map((g) => (
                    <tr key={g.gameId} data-testid="game-row" data-game={g.gameId}>
                      <td data-label="Game">{gameName(g.gameId)}</td>
                      <td className="num" data-label="Started">{num(g.started)}</td>
                      <td className="num" data-label="Finished">{num(g.finished)}</td>
                      <td className="num" data-label="Players per game">{g.avgPlayers.toLocaleString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card section" data-testid="deep-links">
            <h2 className="section__title">Deep links</h2>
            {summary.deepLinks.length === 0 ? (
              <Empty>{noOrphan(`No game links followed ${within}.`)}</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Landed on</th>
                    <th scope="col" className="num">Visitors</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.deepLinks.map((d) => (
                    <tr key={d.game} data-testid="deep-link-row">
                      <td>{gameName(d.game)}</td>
                      <td className="num">{num(d.visitors)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        {byDay && (
          <details className="card section">
            <summary className="section__title">By day, as a table</summary>
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">Visitors</th>
                  <th scope="col" className="num">Views</th>
                  <th scope="col" className="num">Rooms</th>
                  <th scope="col" className="num">Players</th>
                  <th scope="col" className="num">Started</th>
                  <th scope="col" className="num">Finished</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.days].reverse().map((d) => (
                  <tr key={d.day}>
                    <td data-label="Day">{d.day}</td>
                    <td className="num" data-label="Visitors">{num(d.visitors)}</td>
                    <td className="num" data-label="Views">{num(d.views)}</td>
                    <td className="num" data-label="Rooms">{num(d.rooms)}</td>
                    <td className="num" data-label="Players">{num(d.players)}</td>
                    <td className="num" data-label="Started">{num(d.started)}</td>
                    <td className="num" data-label="Finished">{num(d.finished)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * The Analytics tab: loads the summary for the chosen day or range, keeps that choice in the
 * address (#analytics/2026-10-29) so a reload keeps it, and refreshes every minute while the
 * numbers can still move (anything that ends today; a past day is settled).
 */
export function AnalyticsPage({ onSignedOut }: { onSignedOut(): void }) {
  const [span, setSpan] = useState<Span>(() => spanFromHash(location.hash, Date.now()));
  const [loaded, setLoaded] = useState<{ key: string; summary: Summary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = spanHash(span);

  const choose = useCallback((next: Span) => {
    setSpan(next);
    history.replaceState(null, '', spanHash(next));
  }, []);

  // The Analytics tab's own link (#analytics) and the browser's back and forward land here.
  useEffect(() => {
    const onHash = () => setSpan(spanFromHash(location.hash, Date.now()));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetchSummary(spanQuery(span)).then(
        (summary) => {
          if (!live) return;
          setLoaded({ key, summary });
          setError(null);
        },
        (err: unknown) => {
          if (!live) return;
          if (err instanceof SignedOut) onSignedOut();
          else setError('Could not load the numbers. They will try again in a minute.');
        },
      );
    load();
    const timer = spanHasToday(span) ? setInterval(load, 60_000) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
    // The key names the span: a new object for the same span is not a new request.
  }, [key, onSignedOut]);

  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {loaded ? (
        <AnalyticsView summary={loaded.summary} span={span} now={Date.now()} onSpan={choose} busy={loaded.key !== key} />
      ) : (
        !error && <p className="loading">Loading</p>
      )}
    </>
  );
}
