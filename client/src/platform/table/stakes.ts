/**
 * The two numbers every card table shows for a player, worded so they are never confused: the
 * stack as "1,000 chips" and the stake as a gold pill of chips with the figure beside them, read
 * out as "Bet 10" (Poker's middle keeps its word, "Pot 120"). The chips are denominations set
 * from the table's starting stack, never from the bet (betChips). Pure, for the labels, the pill
 * and the tests.
 */
import { formatChips, shortChips } from '../lib/format';

/**
 * How a number is written: in full ("1,500"), short for a small tile ("1.5k"), or `fit`: in full,
 * swapped for the short form only where the tile is too narrow for it (Stakes.tsx, table.css).
 */
export type StakeFormat = 'full' | 'short' | 'fit';

/** The figure as text: `fit` reads in full (a label, an aria line). */
export function chipFigure(n: number, format: StakeFormat = 'full'): string {
  return format === 'short' ? shortChips(n) : formatChips(n);
}

/** "1,000 chips", "1 chip", "0 chips". */
export function stackText(n: number, format: StakeFormat = 'full'): string {
  return `${chipFigure(n, format)} ${n === 1 ? 'chip' : 'chips'}`;
}

/** "Bet 10" (the bet pill's label), or with another word: "Pot 120", "Raise 40". */
export function stakeText(n: number, word = 'Bet', format: StakeFormat = 'full'): string {
  return `${word} ${chipFigure(n, format)}`;
}

/** The four chip colours, smallest first: off-white, lime, lilac, ink with a lime edge. */
export type ChipBand = 'white' | 'lime' | 'lilac' | 'ink';

/** Each band's value as a share of the starting stack: 1%, 5%, 25% and the whole stack, as casino colours step. */
const CHIP_SHARES: readonly { band: ChipBand; share: number }[] = [
  { band: 'white', share: 0.01 },
  { band: 'lime', share: 0.05 },
  { band: 'lilac', share: 0.25 },
  { band: 'ink', share: 1 },
];

export interface Denomination {
  band: ChipBand;
  value: number;
}

/**
 * The chips a table plays with, smallest first, set from its starting stack and never from the
 * bet, so every seat's chips mean the same: at 1,000 they are 10, 50, 250 and 1,000; at 10,000
 * 100, 500, 2,500 and 10,000; at 100 1, 5, 25 and 100. Whole chips, never under one.
 */
export function denominationsFor(start: number): Denomination[] {
  return CHIP_SHARES.map(({ band, share }) => ({ band, value: Math.max(1, Math.round(start * share)) }));
}

export interface BetChips {
  /** The chips drawn, biggest first: at most `max` of them. */
  bands: ChipBand[];
  /** How many chips the bet breaks into, before the cap. */
  count: number;
  /** More chips are owed than drawn: the pill shows a plus after them. */
  more: boolean;
}

/**
 * A bet broken into chips, greedily from the largest denomination down (at a 1,000 start, 200 is
 * four lime chips and 1,040 an ink chip and four off-white ones); the change under one off-white
 * chip, or a bet of nothing, is a single off-white chip, so a stake is never drawn as nothing. At
 * most `max` chips are drawn (three; two on a compact tile), the biggest kept, and `more` says
 * when some are owed, so the drawing never claims a sum it does not show.
 */
export function betChips(bet: number, start: number, max = 3): BetChips {
  const cap = Math.max(1, Math.floor(max));
  const bands: ChipBand[] = [];
  let count = 0;
  const take = (band: ChipBand, k: number) => {
    for (let i = 0; i < k && bands.length < cap; i++) bands.push(band);
    count += k;
  };
  let left = Math.max(0, bet);
  for (const { band, value } of denominationsFor(start).slice().reverse()) {
    const k = Math.floor(left / value);
    take(band, k);
    left -= k * value;
  }
  if (left > 0 || count === 0) take('white', 1);
  return { bands, count, more: count > bands.length };
}
