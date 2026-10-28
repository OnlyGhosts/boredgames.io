import { useEffect, useState } from 'react';
import type { LiveRoom } from '@shared/platform/admin';
import { fetchRooms, SignedOut } from './api';
import { ageText, gameName, num, phaseText } from './format';

export const ROOMS_POLL_MS = 5000;

export function RoomsView({ rooms }: { rooms: LiveRoom[] }) {
  if (rooms.length === 0) return <p className="empty card section">No rooms are open right now.</p>;
  return (
    <section className="card section">
      <table className="table table--stack" data-testid="rooms">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Game</th>
            <th scope="col">Phase</th>
            <th scope="col" className="num">Players</th>
            <th scope="col" className="num">Connected</th>
            <th scope="col" className="num">Watching</th>
            <th scope="col" className="num">Open for</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.code} data-testid="room-row" data-code={r.code}>
              <td data-label="Code" className="code">{r.code}</td>
              <td data-label="Game">{gameName(r.gameId)}</td>
              <td data-label="Phase">{phaseText(r.phase)}</td>
              <td className="num" data-label="Players">{num(r.seated)}</td>
              <td className="num" data-label="Connected">{num(r.connected)}</td>
              <td className="num" data-label="Watching">{num(r.spectators)}</td>
              <td className="num" data-label="Open for">{ageText(r.ageMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The Live rooms tab: every room open right now, refreshed every 5 seconds. Read only. */
export function RoomsPage({ onSignedOut }: { onSignedOut(): void }) {
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetchRooms().then(
        (r) => {
          if (!live) return;
          setRooms(r.rooms);
          setError(false);
        },
        (err: unknown) => {
          if (!live) return;
          if (err instanceof SignedOut) onSignedOut();
          else setError(true);
        },
      );
    load();
    const timer = setInterval(load, ROOMS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [onSignedOut]);

  const players = rooms?.reduce((n, r) => n + r.connected, 0) ?? 0;
  return (
    <div className="page" data-testid="live-rooms">
      <p className="lede">
        {rooms === null ? 'Loading' : `${num(rooms.length)} ${rooms.length === 1 ? 'room' : 'rooms'} open, ${num(players)} ${players === 1 ? 'player' : 'players'} connected.`} Updates every 5&nbsp;seconds.
      </p>
      {error && (
        <p className="alert" role="alert">
          Could not reach the server. Trying again.
        </p>
      )}
      {rooms && <RoomsView rooms={rooms} />}
    </div>
  );
}
