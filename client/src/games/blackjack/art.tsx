/** Blackjack’s lobby picture: a lime card back fanned behind the ace of spades, the ace’s white face edged in the back’s deep lime. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

export function BlackjackArt() {
  return (
    <GameArt game="blackjack">
      <g transform="translate(-1 -1)">
        {/* The two cards fan 40 degrees apart, so wherever the ace’s edge crosses the back’s edge or its printed frame it crosses cleanly, clear of either card’s rounded corners. */}
        <g transform="rotate(-24 28 24)">
          <rect x="17" y="6" width="22" height="32" rx="3" {...shape('lime')} />
          {/* The back’s printed frame, in the deep lime of its own edge; the ace’s card covers its right side. */}
          <rect x="21" y="10" width="14" height="24" rx="1.5" fill="none" stroke={ART.edgeLime} strokeWidth={1.5} />
        </g>
        <g transform="rotate(16 40 24)">
          <rect x="29" y="8" width="22" height="32" rx="3" {...shape('paper', 'lime')} />
          {/* The ace, a path (never text), and its spade, one outline with the stem, both ink well inside the paper face. */}
          <path d="M32.5 19.5L35.5 11.5L37.5 11.5L40.5 19.5L38.5 19.5L38 18L35 18L34.5 19.5ZM35.5 16.5L37.5 16.5L36.5 13.5Z" fill={ART.ink} fillRule="evenodd" />
          <path d="M40 22l-6 7a3.5 3.5 0 0 0 5 4l-1.5 3.5h5l-1.5-3.5a3.5 3.5 0 0 0 5-4z" fill={ART.ink} />
        </g>
      </g>
    </GameArt>
  );
}
