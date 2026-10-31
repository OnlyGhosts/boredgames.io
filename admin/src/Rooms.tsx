import { useEffect, useState } from 'react';
import type { LiveRoom } from '@shared/platform/admin';
import type { GameId } from '@shared/platform/games';
import { UsersIcon } from '../../client/src/platform/components/Icons';
import { RoomCode } from '../../client/src/platform/components/RoomCode';
import { fetchRooms, SignedOut } from './api';
import { ageText, gameName, noOrphan, num } from './format';
import { GAME_ART } from './gameArt';

export const ROOMS_POLL_MS = 5000;

/** Rooms playing first, then the newest. */
export function orderRooms(rooms: LiveRoom[]): LiveRoom[] {
  const playing = (r: LiveRoom) => (r.phase === 'playing' ? 0 : 1);
  return [...rooms].sort((a, b) => playing(a) - playing(b) || a.ageMs - b.ageMs || a.code.localeCompare(b.code));
}

/** One open room: its code on the site's lime tiles, the game, the phase, who is in it and for how long. */
export function RoomCard({ room: r }: { room: LiveRoom }) {
  const playing = r.phase === 'playing';
  const Art = GAME_ART[r.gameId as GameId] as (typeof GAME_ART)[GameId] | undefined;
  // Everyone in the room, seated or watching, against those whose connection is up.
  const away = r.seated + r.spectators - r.connected;
  const stats: Array<[string, number]> = [
    ['Players', r.seated],
    ['Connected', r.connected],
    ['Watching', r.spectators],
  ];
  return (
    <li className="card room" data-testid="room-card" data-code={r.code} data-phase={r.phase}>
      <RoomCode code={r.code} testId="room-card-code" />
      <div className="room__game">
        <span className="room__art">{Art && <Art />}</span>
        <span className="room__name">{gameName(r.gameId)}</span>
        <span className={`pill${playing ? ' pill--accent' : ''}`} data-testid="room-phase">
          {playing ? 'Playing' : 'In the lobby'}
        </span>
      </div>
      <dl className="room__stats">
        {stats.map(([label, n]) => (
          <div key={label}>
            <dd>{num(n)}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      <p className="room__foot">
        <span>{noOrphan(`Open for ${ageText(r.ageMs)}`)}</span>
        {away > 0 && <span className="room__away">{num(away)}&nbsp;away</span>}
      </p>
    </li>
  );
}

export function RoomsView({ rooms }: { rooms: LiveRoom[] }) {
  if (rooms.length === 0) {
    return (
      <div className="card rooms-empty" data-testid="rooms-empty">
        <span className="rooms-empty__icon" aria-hidden="true">
          <UsersIcon size={24} />
        </span>
        <p className="rooms-empty__title">{noOrphan('No rooms are open right now.')}</p>
        <p className="rooms-empty__text">{noOrphan('This page updates every 5 seconds, so a new room shows up here by itself.')}</p>
      </div>
    );
  }
  return (
    <ul className="room-grid" data-testid="rooms">
      {orderRooms(rooms).map((r) => (
        <RoomCard key={r.code} room={r} />
      ))}
    </ul>
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
      {/* With no rooms, the empty card says it all. */}
      {rooms?.length !== 0 && (
        <p className="lede">
          {rooms === null ? 'Loading' : `${num(rooms.length)} ${rooms.length === 1 ? 'room' : 'rooms'} open, ${num(players)} ${players === 1 ? 'player' : 'players'} connected.`} Updates every 5&nbsp;seconds.
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          Could not reach the server. Trying again.
        </p>
      )}
      {rooms && <RoomsView rooms={rooms} />}
    </div>
  );
}
