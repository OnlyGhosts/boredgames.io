/**
 * Click Race’s lobby picture: a big lime button on a white base, mid-tap. The template of a game’s
 * picture: a few flat shapes from the ART palette, each through `shape()` (a lime or lilac fill
 * edged in its own deep shade, a white one in the deep lime or lilac of the shape it belongs with)
 * or `Line`, inside the GameArt frame, which draws the shadow.
 */
import { GameArt, Line, shape } from '../../platform/components/GameArt';

export function ClickRaceArt() {
  return (
    <GameArt game="template">
      <Line d="M32 4.5v4.5" fill="lilac" width={1.8} />
      <Line d="M19.5 7.5l3.5 4" fill="lilac" width={1.8} />
      <Line d="M44.5 7.5l-3.5 4" fill="lilac" width={1.8} />
      <rect x="12" y="28" width="40" height="12" rx="6" {...shape('paper', 'lime')} />
      <ellipse cx="32" cy="24" rx="15" ry="10" {...shape('lime')} />
    </GameArt>
  );
}
