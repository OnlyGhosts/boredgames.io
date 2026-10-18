/** The Spy Game’s lobby picture: a lilac hat with a lime band, pulled down on a white face in dark glasses, the face edged in the hat’s deep lilac. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

export function SpygameArt() {
  return (
    <GameArt game="spygame">
      <ellipse cx="32" cy="31" rx="12" ry="9.5" {...shape('paper', 'lilac')} />
      <path d="M22 20c1-10 3-13 10-13s9 3 10 13z" {...shape('lilac')} />
      <rect x="21" y="16" width="22" height="5" {...shape('lime')} />
      <path d="M8 24c10-5 38-5 48 0c-10 4-38 4-48 0z" {...shape('lilac')} />
      {/* The glasses, ink on the face and clear of every edge round it. */}
      <g fill={ART.ink}>
        <rect x="24.5" y="30.6" width="6.5" height="4.5" rx="2" />
        <rect x="33" y="30.6" width="6.5" height="4.5" rx="2" />
        <rect x="30.5" y="32.2" width="3" height="1.6" />
      </g>
    </GameArt>
  );
}
