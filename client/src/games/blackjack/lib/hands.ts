/**
 * How a row of hands fits its space (pure, for the components and the tests). Every hand is always
 * its cards with its total. A seat's hands sit side by side on its tile and past what fits the row
 * scrolls sideways (blackjack.css), following the hand in play. My split hands on the stage never
 * scroll: they wrap into a grid (planGrid) that takes the room the table leaves empty over the
 * stage, all at one card size. The page never scrolls.
 */

/** Where a row of hands sits: my hands on the stage, another player's there when I am not dealt in, or a seat's on its tile (in miniature). */
export type HandPlace = 'mine' | 'stage' | 'seat';

/** A hand's slot in its row: from its left edge in the row's content (not moved by scrolling), and its width, in px. */
export interface SlotBox {
  left: number;
  width: number;
}

/**
 * Where a row `view` px wide, holding `content` px of hands, scrolls to bring the hand in `slot` to
 * its middle, as far as the row goes (0 when every hand is in view): the hand in play, as play
 * moves on or a split adds a hand. The middle is where the row's snap points are (each slot snaps
 * to its centre), so the row comes to rest where a swipe would leave it.
 */
export function scrollToHand(slot: SlotBox, view: number, content: number): number {
  const most = Math.max(0, content - view);
  return Math.round(Math.min(most, Math.max(0, slot.left + slot.width / 2 - view / 2)));
}

/** What my split hands have to lay out in, in px: the grid they wrap into is solved by planGrid. */
export interface GridFit {
  /** The row's width. */
  width: number;
  /** The most height the hands may take: the stage and the room the table leaves empty over it. */
  height: number;
  /** The stage's own height: one row stays inside it (the stage only grows for a grid of two rows or more). */
  base?: number;
  /** The card a hand on its own gets: the most the cards ever are. */
  solo: number;
  /** How far each card past the first steps over, as a share of a card's width. */
  step: number;
  /** A hand's height in card widths, its pill aside (table.css --hand-k). */
  handK: number;
  /** The totals' pill height. */
  pill: number;
  /** The room under a hand's cards for its stake chip (0 without one). */
  foot: number;
  /** Each hand's cards (2 at least: two places before the deal). */
  fans: readonly number[];
  /** The narrowest a hand's cell ever is: the widest words on a hand (its total, its stake or how it ended). */
  least: number;
  /** The gaps between hands, across and down. */
  gapX: number;
  gapY: number;
}

/** The least card a grid that keeps every hand's words apart must show to be taken over one that shows larger cards. */
export const LEAST_GRID_CARD = 12;

/** Past what any grid shows at LEAST_GRID_CARD (16 hands on a 320px phone), my hands go back to one row at this card that scrolls sideways, its ends fading. */
export const SCROLL_CARD = 26;

/** How my split hands lay out: `cols` across, `rows` down, every card `card` px wide, each hand in a cell `cell` px wide, `height` px in all. */
export interface GridPlan {
  cols: number;
  rows: number;
  card: number;
  cell: number;
  height: number;
}

/** One hand's height with cards `w` wide: its pill over the corner, its fan, its outline and its stake chip under it. */
export function handHeight(fit: Pick<GridFit, 'pill' | 'handK' | 'foot'>, w: number): number {
  return fit.pill + w * fit.handK + 4 + fit.foot;
}

/**
 * The grid my split hands wrap into: of every count of rows (1 to one per hand), the one whose
 * cards come out largest inside the width and height they have, never past a hand alone's size.
 * A row more only wins by a clear 2px of card, so two rows are only taken where one row's cards
 * are cramped. Each hand's cell is as wide as the widest fan (or its least, a pill with a word),
 * with a little air while the row has room. Whole px, rounded down, so nothing overflows.
 */
export function planGrid(fit: GridFit): GridPlan {
  const n = Math.max(1, fit.fans.length);
  const most = Math.max(2, ...fit.fans);
  const span = 1 + fit.step * (most - 1);
  // A fan's edges and outline (6px), and a pixel more for each card past the first (blackjack.css).
  const edge = 6 + (most - 1);
  const plans: { plan: GridPlan; roomy: boolean }[] = [];
  for (let rows = 1; rows <= n; rows += 1) {
    const cols = Math.ceil(n / rows);
    if (Math.ceil(n / cols) !== rows) continue;
    const share = (fit.width - (cols - 1) * fit.gapX) / cols;
    const byWidth = (share - edge) / span;
    const room = rows === 1 && fit.base !== undefined ? Math.min(fit.base, fit.height) : fit.height;
    // One row keeps a hand alone's height: its chips sit over the cards' blank lower edge (blackjack.css), with no room of their own.
    const foot = rows === 1 ? 0 : fit.foot;
    const byHeight = ((room - (rows - 1) * fit.gapY) / rows - fit.pill - 4 - foot) / fit.handK;
    const card = Math.max(1, Math.floor(Math.min(fit.solo, byWidth, byHeight)));
    const need = Math.max(edge + card * span, fit.least);
    const cell = Math.floor(Math.min(share, Math.max(need, need + card * 0.6)));
    // A cell narrower than a hand's words would push them into its neighbour.
    plans.push({ plan: { cols, rows, card, cell, height: rows * handHeight({ ...fit, foot }, card) + (rows - 1) * fit.gapY }, roomy: share >= fit.least });
  }
  const pick = (from: typeof plans) => from.reduce<GridPlan | null>((best, { plan }) => (best === null || plan.card >= best.card + 2 ? plan : best), null);
  // Only where no grid both keeps the words apart and shows a card of LEAST_GRID_CARD does the largest card win regardless.
  const roomy = pick(plans.filter((p) => p.roomy));
  return roomy && roomy.card >= LEAST_GRID_CARD ? roomy : (pick(plans) as GridPlan);
}
