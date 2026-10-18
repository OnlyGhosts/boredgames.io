/** Poker’s lobby picture: a stack of chips, lime on top of white and lilac, with a lilac one leaning on it; the white chip borrows the lilac chip’s deep edge. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

/** The stack’s chips: 16 across, their faces 6.5 deep in perspective, each 6 thick. */
const RX = 16;
const RY = 6.5;
const LEFT = 12;

/** A chip’s side: the front half of its rim at `top` and the same curve `depth` lower, closed down the sides. */
const side = (top: number, depth: number): string =>
  `M${LEFT} ${top}a${RX} ${RY} 0 0 0 ${2 * RX} 0v${depth}a${RX} ${RY} 0 0 1 ${-2 * RX} 0z`;

/** The ring printed on a chip’s face: an ellipse `tx` thick at the sides and `ty` at the top and bottom, filled even-odd. */
function ring(cx: number, cy: number, rx: number, ry: number, tx: number, ty: number): string {
  const ellipse = (x: number, y: number) => `M${cx - x} ${cy}a${x} ${y} 0 1 0 ${2 * x} 0a${x} ${y} 0 1 0 ${-2 * x} 0z`;
  return `${ellipse(rx, ry)}${ellipse(rx - tx, ry - ty)}`;
}

export function PokerArt() {
  return (
    <GameArt game="poker">
      <path d={side(27, 6)} {...shape('lilac')} />
      <path d={side(21, 6)} {...shape('paper', 'lilac')} />
      <path d={side(15, 6)} {...shape('lime')} />
      <ellipse cx={LEFT + RX} cy="15" rx={RX} ry={RY} {...shape('lime')} />
      {/* The rings, ink inside each face and clear of its edge. */}
      <path d={ring(LEFT + RX, 15, 9.5, 3.2, 1.9, 1.2)} fill={ART.ink} fillRule="evenodd" />
      <g transform="rotate(-24 49 28)">
        <ellipse cx="51.4" cy="28" rx="8" ry="9" {...shape('lilac')} />
        <ellipse cx="49" cy="28" rx="8" ry="9" {...shape('lilac')} />
        <path d={ring(49, 28, 4.6, 5.2, 1.7, 1.7)} fill={ART.ink} fillRule="evenodd" />
      </g>
    </GameArt>
  );
}
