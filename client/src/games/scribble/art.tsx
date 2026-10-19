/** Scribble’s lobby picture: a lime marker with a lilac cap, its white cone edged in the body’s deep lime and its deep lilac nib on the lilac squiggle it drew. */
import { ART, GameArt, Line, shape } from '../../platform/components/GameArt';

export function ScribbleArt() {
  return (
    <GameArt game="scribble">
      {/* The squiggle starts under the marker’s point and leaves it steeply, dipping first, so it never runs along the marker’s underside. */}
      <Line d="M12 36c2 4 6 4.5 10 4s9-5 13-3s8 4 12 3s5-4 6-2" fill="lilac" width={2.4} />
      <g transform="rotate(-35 33 20)">
        <rect x="20" y="14" width="29" height="12" rx="1.5" {...shape('lime')} />
        <rect x="45" y="13" width="8" height="14" rx="1.5" {...shape('lilac')} />
        <path d="M20 14l-12 6l12 6z" {...shape('paper', 'lime')} />
        {/* The nib: the cone’s point in the deep lilac of the squiggle it draws. Its sides run 0.2 into the cone’s edge (which meets itself 2.46 in from the point), so no seam of paper shows between the two where their anti-aliasing meets. */}
        <path d="M10 20l6-3v6z" fill={ART.edgeLilac} />
      </g>
    </GameArt>
  );
}
