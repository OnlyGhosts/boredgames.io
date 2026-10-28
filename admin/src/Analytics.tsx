import { useCallback, useEffect, useState } from 'react';
import { RANGES, type Range, type Summary } from '@shared/platform/admin';
import { fetchSummary, SignedOut } from './api';
import { BarChart } from './BarChart';
import { gameName, hourText, num, sourceLabel } from './format';

const RANGE_LABEL: Record<Range, string> = { today: 'Today', '7d': '7 days', '30d': '30 days' };

interface ViewProps {
  summary: Summary;
  range: Range;
  onRange(range: Range): void;
}

export function RangeTabs({ range, onRange }: { range: Range; onRange(range: Range): void }) {
  return (
    <div className="segmented" role="group" aria-label="Range">
      {RANGES.map((r) => (
        <button key={r} type="button" className="segmented__item" aria-pressed={r === range} onClick={() => onRange(r)} data-testid={`range-${r}`}>
          {RANGE_LABEL[r]}
        </button>
      ))}
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

export function AnalyticsView({ summary, range, onRange }: ViewProps) {
  const { totals } = summary;
  return (
    <div className="page" data-testid="analytics">
      <RangeTabs range={range} onRange={onRange} />

      <section className="tiles" aria-label="Totals">
        <Tile label="Visitors" value={totals.visitors} testId="tile-visitors" />
        <Tile label="Page views" value={totals.views} testId="tile-views" />
        <Tile label="Rooms created" value={totals.rooms} testId="tile-rooms" />
        <Tile label="Players joined" value={totals.players} testId="tile-players" />
        <Tile label="Games started" value={totals.started} testId="tile-started" />
        <Tile label="Games finished" value={totals.finished} testId="tile-finished" />
      </section>

      {summary.days.length > 1 && (
        <section className="card section">
          <h2 className="section__title">Visitors by day</h2>
          <BarChart days={summary.days.map((d) => ({ day: d.day, value: d.visitors }))} unit="visitors" />
        </section>
      )}

      <div className="grid">
        <section className="card section" data-testid="sources">
          <h2 className="section__title">Sources</h2>
          {summary.sources.length === 0 ? (
            <Empty>No visits yet in this range.</Empty>
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
            <div>
              <dt>Joined by tapping the room on the same Wi-Fi</dt>
              <dd data-testid="joins-nearby">{num(summary.joinsNearby)}</dd>
            </div>
            <div>
              <dt>Typed the code or opened a&nbsp;link</dt>
              <dd data-testid="joins-code">{num(summary.joinsCode)}</dd>
            </div>
            <div>
              <dt>Average players per room</dt>
              <dd>{summary.avgPlayersPerRoom.toLocaleString('en-GB')}</dd>
            </div>
            <div>
              <dt>Most players online at once</dt>
              <dd data-testid="peak-players">{num(summary.peakPlayers)}</dd>
            </div>
            <div>
              <dt>Busiest hour for joining (UK&nbsp;time)</dt>
              <dd>{summary.busiestHour === null ? 'None yet' : hourText(summary.busiestHour)}</dd>
            </div>
          </dl>
        </section>

        <section className="card section" data-testid="games">
          <h2 className="section__title">Games</h2>
          {summary.games.length === 0 ? (
            <Empty>No rooms yet in this range.</Empty>
          ) : (
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Game</th>
                  <th scope="col" className="num">Rooms</th>
                  <th scope="col" className="num">Players</th>
                  <th scope="col" className="num">Started</th>
                  <th scope="col" className="num">Finished</th>
                  <th scope="col" className="num">Players per game</th>
                </tr>
              </thead>
              <tbody>
                {summary.games.map((g) => (
                  <tr key={g.gameId}>
                    <td data-label="Game">{gameName(g.gameId)}</td>
                    <td className="num" data-label="Rooms">{num(g.rooms)}</td>
                    <td className="num" data-label="Players">{num(g.players)}</td>
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
            <Empty>No game links followed yet.</Empty>
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

      {summary.days.length > 1 && (
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
  );
}

/** The Analytics tab: loads the summary for the chosen range and refreshes it every minute. */
export function AnalyticsPage({ onSignedOut }: { onSignedOut(): void }) {
  const [range, setRange] = useState<Range>('today');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (r: Range) => {
      fetchSummary(r).then(
        (s) => {
          setSummary(s);
          setError(null);
        },
        (err: unknown) => {
          if (err instanceof SignedOut) onSignedOut();
          else setError('Could not load the numbers. They will try again in a minute.');
        },
      );
    },
    [onSignedOut],
  );

  useEffect(() => {
    load(range);
    const timer = setInterval(() => load(range), 60_000);
    return () => clearInterval(timer);
  }, [range, load]);

  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {summary ? (
        <AnalyticsView summary={summary} range={range} onRange={setRange} />
      ) : (
        !error && <p className="loading">Loading</p>
      )}
    </>
  );
}
