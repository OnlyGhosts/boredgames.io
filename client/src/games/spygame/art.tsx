/** The Spy Game’s lobby picture: a lilac hat with a lime band, pulled down on a white face in dark glasses, the face edged in the hat’s deep lilac. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

export function SpygameArt() {
  return (
    <GameArt game="spygame">
      <ellipse cx="32" cy="31" rx="12" ry="9.5" {...shape('paper', 'lilac')} />
      <path d="M22 20c1-10 3-13 10-13s9 3 10 13z" {...shape('lilac')} />
      {/* The band pokes out past the crown on both sides; its lower corners sit under the brim. */}
      <rect x="21" y="14" width="22" height="6" {...shape('lime')} />
      {/* The brim: a lens whose tips open wide (its control points sit close to them), so the lilac between its two edges is 0.9 wide a unit in from where they meet and 1.5 wide at 1.75, never a hairline. */}
      <path d="M8 24c4-6 44-6 48 0c-4 5-44 5-48 0z" {...shape('lilac')} />
      {/* The glasses, ink on the face and clear of every edge round it (2.15 under the brim’s). */}
      <g fill={ART.ink}>
        <rect x="24.5" y="31" width="6.5" height="4.5" rx="2" />
        <rect x="33" y="31" width="6.5" height="4.5" rx="2" />
        <rect x="30.5" y="33" width="3" height="1.5" />
      </g>
    </GameArt>
  );
}
