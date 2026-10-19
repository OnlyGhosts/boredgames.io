/** Quip Game’s lobby picture: two speech bubbles, a lilac one behind a white one that is still typing, edged in the same deep lilac. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

export function QuipgameArt() {
  return (
    <GameArt game="quipgame">
      <path d="M24 6h30a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H38l-7 5v-5h-7a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" {...shape('lilac')} />
      <path d="M8 16h28a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H20l-7 5v-5H8a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z" {...shape('paper', 'lilac')} />
      {/* The typing dots, ink well inside the white bubble. */}
      <g fill={ART.ink}>
        <circle cx="15" cy="26" r="2.5" />
        <circle cx="22" cy="26" r="2.5" />
        <circle cx="29" cy="26" r="2.5" />
      </g>
    </GameArt>
  );
}
