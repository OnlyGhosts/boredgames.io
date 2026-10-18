/** Scribble’s lobby picture: a lime marker with a lilac cap, its white cone edged in the body’s deep lime and its deep lilac nib on the lilac squiggle it drew. */
import { ART, GameArt, Line, shape } from '../../platform/components/GameArt';

export function ScribbleArt() {
  return (
    <GameArt game="scribble">
      <Line d="M12 36c4-6 9-6 12-1s8 4 12-1s9-5 13 1" fill="lilac" width={2.4} />
      <g transform="rotate(-35 33 20)">
        <rect x="20" y="14" width="29" height="12" rx="1.5" {...shape('lime')} />
        <rect x="45" y="13" width="8" height="14" rx="1.5" {...shape('lilac')} />
        <path d="M20 14l-12 6l12 6z" {...shape('paper', 'lime')} />
        {/* The nib: the cone’s point in the deep lilac of the squiggle it draws, inside the cone’s edge. */}
        <path d="M10.5 20.05l5.5-2.75v5.5z" fill={ART.edgeLilac} />
      </g>
    </GameArt>
  );
}
