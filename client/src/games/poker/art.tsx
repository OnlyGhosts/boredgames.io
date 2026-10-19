/** Poker’s lobby picture: a stack of chips, lime on top of white and lilac, with a lilac one leaning on it face out; the white chip borrows the lilac chip’s deep edge. */
import { ART, GameArt, shape } from '../../platform/components/GameArt';

/** The stack’s chips: 16 across, their faces 6.5 deep in perspective, each 6 thick. */
const RX = 16;
const RY = 6.5;
const LEFT = 11;

/** A chip’s side: the front half of its rim at `top` and the same curve `depth` lower, closed down the sides. */
const side = (top: number, depth: number): string =>
  `M${LEFT} ${top}a${RX} ${RY} 0 0 0 ${2 * RX} 0v${depth}a${RX} ${RY} 0 0 1 ${-2 * RX} 0z`;

/**
 * The leaning chip: its face alone, 9.5 by 11, tilted 24 degrees and drawn over the stack’s right
 * end. (A side for it, its rim once more a few units over, tapers to nothing at the top and the
 * bottom of the rim, and where that taper is thinner than the two edges round it, it shows as a
 * hairline; the stack’s sides avoid that by being closed with straight lines down their ends.)
 * Its outline crosses the top face’s rim at 39 and 54 degrees, the sides’ rims at 68 or more and
 * the stack’s right edge at 84, never less than the 30 the GameArt rules ask: the one place two
 * curved outlines of different shapes meet, and a unit lower it grazed the top face’s rim at 4
 * degrees, a tangency that only read clean because both edges are dark (art.test.ts measures it).
 */
const CHIP = { cx: 45, cy: 27, rx: 9.5, ry: 11 };

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
      <path d={ring(LEFT + RX, 15, 9.5, 3, 2, 1.5)} fill={ART.ink} fillRule="evenodd" />
      <g transform={`rotate(-24 ${CHIP.cx} ${CHIP.cy})`}>
        <ellipse cx={CHIP.cx} cy={CHIP.cy} rx={CHIP.rx} ry={CHIP.ry} {...shape('lilac')} />
        <path d={ring(CHIP.cx, CHIP.cy, 5.5, 6, 2, 2)} fill={ART.ink} fillRule="evenodd" />
      </g>
    </GameArt>
  );
}
