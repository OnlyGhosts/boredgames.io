import type { ReactNode } from 'react';
import type { GameId } from '@shared/platform/games';

/**
 * The frame every game’s lobby picture (GameClientModule.Art) is drawn in: a 64x46 canvas in the
 * mascots’ flat style, drawn to read on every tile it sits on: the dark theme’s graphite panel, the
 * light theme’s white one and the picked tile’s lilac.
 *
 * - Shapes are flat lime, lilac or paper, and every edge is deep lime or deep lilac: no grey and no
 *   ink anywhere on an outline. `shape('lime')` and `shape('lilac')` rim a shape 2.2 wide in the
 *   deep shade of its own colour; a white (paper) shape has no colour of its own to deepen, so it
 *   borrows the deep edge of the colour it sits beside or belongs with: `shape('paper', 'lilac')`
 *   for a bubble beside a lilac one or a face under a lilac hat, `shape('paper', 'lime')` for a card
 *   face over a lime card. A line (a squiggle, a spark) is `Line`, lime or lilac with the same edge.
 * - Ink is only ever a filled detail well inside a shape (an ace on its white face, the dots in a
 *   bubble, a chip’s ring, a spy’s glasses), at least 2 units clear of that shape’s edge, so nothing
 *   black meets the tile and ink is never a stroke. Any other detail (a marker’s nib, a card back’s print)
 *   is filled in one of the two deep edge colours.
 * - The shadow is the drawing once more underneath, offset right and down, with every shape filled
 *   in its own edge colour (a white shape in the one it borrows) and the details left out
 *   (components.css recolours it): a flat sticker shadow that reads on graphite, on white and on
 *   lilac alike. A game draws its picture once and gets the shadow for free.
 * - Deep lilac rims a lilac shape as firmly as deep lime rims a lime one (tokens.css has the
 *   numbers), so neither colour's outline looks faded beside the other's.
 * - The picked tile is lilac, so there (and only there) lobby.css swaps both edges for deeper cuts
 *   of the same hues (at least 3:1 on the lilac), and every edge and shadow still parts its shape
 *   from the tile.
 */
export const ART_VIEWBOX = '0 0 64 46';

/** The palette a picture may use, through the theme tokens (the same colours in both themes): three fills, the two deep edges and ink for details. No grey. */
export const ART = {
  ink: 'var(--game-ink)',
  lime: 'var(--color-primary)',
  lilac: 'var(--color-secondary)',
  paper: 'var(--game-paper)',
  edgeLime: 'var(--game-edge-lime)',
  edgeLilac: 'var(--game-edge-lilac)',
} as const;

/** The two colours with a deep edge of their own; a line is one of them. */
export type ArtColour = 'lime' | 'lilac';

/** The three fills a shape can be; paper borrows the edge of a colour. */
export type ArtFill = ArtColour | 'paper';

const EDGE_OF: Record<ArtColour, string> = { lime: ART.edgeLime, lilac: ART.edgeLilac };

/** How wide every edge is, round the shape’s outline (half of it outside, half inside). */
export const EDGE_WIDTH = 2.2;

const ROUND = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** What `shape()` spreads on an SVG shape. */
export interface ShapeProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
}

/**
 * A flat shape: its fill and a 2.2-unit edge, round joins. A lime or lilac shape is rimmed in the
 * deep shade of its own colour; a paper shape names the colour whose deep edge it borrows.
 */
export function shape(fill: ArtColour): ShapeProps;
export function shape(fill: 'paper', edge: ArtColour): ShapeProps;
export function shape(fill: ArtFill, edge?: ArtColour): ShapeProps {
  const rim = fill === 'paper' ? (edge ?? 'lime') : fill;
  return { fill: ART[fill], stroke: EDGE_OF[rim], strokeWidth: EDGE_WIDTH, ...ROUND };
}

/**
 * A line in lime or lilac with the same edge (a squiggle, a spark): the path twice, first in the
 * deep edge colour 4.4 wider, then in the fill on top, so the edge shows 2.2 each side.
 */
export function Line({ d, fill, width }: { d: string; fill: ArtColour; width: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={EDGE_OF[fill]} strokeWidth={width + 2 * EDGE_WIDTH} {...ROUND} />
      <path d={d} fill="none" stroke={ART[fill]} strokeWidth={width} {...ROUND} />
    </>
  );
}

/** How far the sticker shadow sits right and down: as far as an edge is wide. */
const SHADOW_OFFSET = EDGE_WIDTH;

interface Props {
  game: GameId;
  children: ReactNode;
}

export function GameArt({ game, children }: Props) {
  return (
    <svg className="game-art" viewBox={ART_VIEWBOX} aria-hidden="true" focusable="false" data-art={game}>
      <g className="game-art__shadow" transform={`translate(${SHADOW_OFFSET} ${SHADOW_OFFSET})`}>
        {children}
      </g>
      <g>{children}</g>
    </svg>
  );
}
