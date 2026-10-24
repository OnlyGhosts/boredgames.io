/**
 * How a row of hands fits its space (pure, for the components and the tests). Every hand is always
 * its cards, at the size a hand on its own gets there (the round's size: a split never shrinks
 * them), with its stake and total. As many hands sit side by side as fit; past that the row scrolls
 * sideways inside its box (blackjack.css), a hand to a snap, its cut ends fading, and follows the
 * hand in play. The stage around it never moves or resizes, and the page never scrolls.
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

/** The smallest card my row shrinks to so every hand shows at once; past that it scrolls (a long run of splits on a phone). */
export const LEAST_FIT_CARD = 26;

/** What a row of hands holds, in px, to fit them all side by side. */
export interface RowFit {
  /** The row's width. */
  width: number;
  /** The card a hand on its own gets there: the most the cards ever are. */
  solo: number;
  /** How far each card past the first steps over, as a share of a card's width. */
  step: number;
  /** Each hand's cards (2 at least: two places before the deal). */
  fans: readonly number[];
  /** The widest words over a hand's corner, which keep their width whatever the cards' size. */
  head: number;
  /** The narrowest a hand's slot ever is (a pill with a word in it). */
  least: number;
  /** The gap between hands. */
  gap: number;
}

/** The row's width with cards `w` px wide: each slot its fan, its words or its pill, whichever is widest. */
function rowWidth(fit: RowFit, w: number): number {
  const slots = fit.fans.map((n) => Math.max(6 + w * (1 + fit.step * (Math.max(2, n) - 1)), fit.head + 3, fit.least));
  return slots.reduce((a, b) => a + b, 0) + fit.gap * Math.max(0, fit.fans.length - 1);
}

/**
 * The card width that shows every hand of the row at once (my split hands on the stage): the solo
 * size while they fit, else as large as fits, never below LEAST_FIT_CARD (past that the row scrolls).
 * Whole px, rounded down, so the hands never overflow by a fraction.
 */
export function fitCardWidth(fit: RowFit): number {
  if (fit.width <= 0 || fit.solo <= 0 || rowWidth(fit, fit.solo) <= fit.width) return fit.solo;
  let lo = 0;
  let hi = fit.solo;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (rowWidth(fit, mid) <= fit.width) lo = mid;
    else hi = mid;
  }
  return Math.max(LEAST_FIT_CARD, Math.floor(lo));
}
