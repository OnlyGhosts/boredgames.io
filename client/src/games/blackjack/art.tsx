/** Blackjack’s lobby picture: a lime card back fanned behind the ace of spades, the ace’s white face edged in the back’s deep lime. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

const ACE_FONT = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10 } as const;

export function BlackjackArt() {
  return (
    <GameArt game="blackjack">
      <g transform="translate(-2 -2)">
        <g transform="rotate(-14 30 24)">
          <rect x="18" y="6" width="22" height="32" rx="3" {...shape('lime')} />
          {/* The back’s printed frame and mark, in the deep lime of its own edge (the ace’s card covers part of them). */}
          <rect x="22" y="10" width="14" height="24" rx="1.5" fill="none" stroke={ART.edgeLime} strokeWidth={1.5} />
          <circle cx="29" cy="22" r="4" fill={ART.edgeLime} />
        </g>
        <g transform="rotate(10 38 26)">
          <rect x="28" y="8" width="22" height="32" rx="3" {...shape('paper', 'lime')} />
          {/* The ace and its spade, ink well inside the paper face. */}
          <text x="32" y="19.5" fill={ART.ink} style={ACE_FONT}>
            A
          </text>
          <path d="M39 20.5l-6 7a3.3 3.3 0 0 0 5 4l1-1.5l1 1.5a3.3 3.3 0 0 0 5-4zM38 29.5h2l1.5 5.5h-5z" fill={ART.ink} />
        </g>
      </g>
    </GameArt>
  );
}
