import type { ReactNode } from 'react';
import type { GameId } from '@shared/platform/games';

/**
 * The frame every game’s lobby picture (GameClientModule.Art) is drawn in: a 64x46 canvas in the
 * mascots’ flat style, drawn to read on every tile it sits on: the dark theme’s graphite panel, the
 * light theme’s white one and the picked tile’s lilac. A tile shows it about 69 to 96px wide, so at
 * a device pixel ratio of 1 to 3 a unit is 1.1 to 4.5 pixels, and the rules below are what keeps a
 * picture clean at every one of those sizes.
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
 *   is filled in one of the two deep edge colours. A letter is a path, never `<text>`: text takes the
 *   platform’s subpixel smoothing and shows coloured fringes that a path does not.
 * - A picture is its shapes and nothing else: no shadow. (A sticker shadow, every shape once more
 *   underneath in its edge colour and 2.2 units right and down, was tried: it is the colour of the
 *   edges it sits against, so it merged with them into a step at every rounded corner, a second tip
 *   under every point and a sliver at every join, and at a few pixels a unit none of it read as a
 *   shadow.)
 * - Geometry sits on the half-unit grid: every coordinate and size of a shape or a line is a
 *   multiple of 0.5 (a detail inside a shape may sit finer), so two shapes meant to touch share the
 *   coordinate they touch on and never leave a sliver of a third colour between. Where two edges
 *   cross they cross at 30 degrees or more, and where they do not cross they stay 1.5 units apart
 *   (fill or tile showing between them) or lie on top of each other: anything between renders as a
 *   hairline, and a graze (Poker’s chip once met the top face’s rim at 4 degrees) is a sliver one
 *   nudge away, so art.test.ts measures the chip’s crossings. No deliberate feature (a printed
 *   line, a letter’s stroke, a ring) is thinner than 1.5 units. A path whose `d` has more than one
 *   subpath sets fill-rule evenodd, because under the default nonzero rule two subpaths wound
 *   opposite ways cancel where they overlap and leave a gap.
 * - Deep lilac rims a lilac shape as firmly as deep lime rims a lime one (tokens.css has the
 *   numbers), so neither colour's outline looks faded beside the other's.
 * - The picked tile is lilac, so there (and only there) lobby.css swaps both edges for deeper cuts
 *   of the same hues (at least 3:1 on the lilac) and the lilac fill (`--game-lilac`) for a paler cut
 *   (`--game-lilac-picked`): a lilac shape filled in the tile's own lilac would be an outline there.
 *   Lime never needs a cut of its own, because no tile is lime.
 */
export const ART_VIEWBOX = '0 0 64 46';

/** The palette a picture may use, through the theme tokens (the same colours in both themes): three fills, the two deep edges and ink for details. No grey. */
export const ART = {
  ink: 'var(--game-ink)',
  lime: 'var(--color-primary)',
  lilac: 'var(--game-lilac)',
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

interface Props {
  game: GameId;
  children: ReactNode;
}

export function GameArt({ game, children }: Props) {
  return (
    <svg className="game-art" viewBox={ART_VIEWBOX} aria-hidden="true" focusable="false" data-art={game}>
      {children}
    </svg>
  );
}
