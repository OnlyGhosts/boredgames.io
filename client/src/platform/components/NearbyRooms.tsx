import { nearbyMeta, roomTitle, type NearbyCard } from '../lib/nearby';
import { Avatar } from './Avatar';

interface Props {
  rooms: NearbyCard[];
  disabled?: boolean;
  onJoin(code: string): void;
}

/** "On your Wi-Fi": rooms made on this network lately, each joined with one tap. Absent when there are none. */
export function NearbyRooms({ rooms, disabled, onJoin }: Props) {
  if (rooms.length === 0) return null;
  return (
    <section className="nearby" aria-label="On your Wi-Fi" data-testid="nearby">
      <ul className="nearby__list">
        {rooms.map((room) => (
          <li key={room.code} className="nearby__card" data-testid="nearby-room" data-code={room.code}>
            <Avatar avatar={room.host.avatar} size="md" />
            <span className="nearby__text">
              <span className="nearby__title">{roomTitle(room.host.name)}</span>
              <span className="nearby__meta" data-testid="nearby-meta">
                {nearbyMeta(room)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn--primary btn--sm nearby__join"
              onClick={() => onJoin(room.code)}
              disabled={disabled}
              aria-label={`Join ${roomTitle(room.host.name)}`}
              data-testid="nearby-join"
            >
              Join
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
