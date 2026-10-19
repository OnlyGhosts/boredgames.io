/**
 * How a row of hands fits its space (pure, for the components and the tests). Every hand is always
 * its cards, at the size a hand on its own gets there (the round's size: a split never shrinks
 * them), with its stake and total. As many hands sit side by side as fit; past that the row scrolls
 * sideways inside its box (blackjack.css), a hand to a snap, its cut ends fading, and follows the
 * hand in play. The stage around it never moves or resizes, and the page never scrolls.
 */

/** Where a row of hands sits: my hands on the stage, or another player's there when I am not dealt in. */
export type HandPlace = 'mine' | 'stage';

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
