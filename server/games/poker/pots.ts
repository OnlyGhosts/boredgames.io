/** Side pots from what every seat committed, and the split of a pot among its winners. */

export interface PotEntry {
  id: string;
  /** Chips put in the middle this hand. */
  committed: number;
  /** Still holding cards (folded players feed the pots but never win one). */
  contender: boolean;
}

export interface Pot {
  amount: number;
  /** The contenders who matched this pot's level, in seat order. */
  eligible: string[];
}

/**
 * One pot per distinct amount a contender committed, lowest first: everybody contributes up to
 * that level, and only the contenders who reached it can win it. Chips a folded player put in
 * above every contender's level (none after uncalled bets are refunded) fall into the last pot.
 */
export function buildPots(entries: readonly PotEntry[]): Pot[] {
  const levels = [...new Set(entries.filter((e) => e.contender && e.committed > 0).map((e) => e.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = entries.reduce((sum, e) => sum + Math.min(e.committed, level) - Math.min(e.committed, previous), 0);
    pots.push({ amount, eligible: entries.filter((e) => e.contender && e.committed >= level).map((e) => e.id) });
    previous = level;
  }
  const total = entries.reduce((sum, e) => sum + e.committed, 0);
  const allocated = pots.reduce((sum, p) => sum + p.amount, 0);
  if (total > allocated && pots.length > 0) pots[pots.length - 1].amount += total - allocated;
  return pots;
}

/** Splits `amount` evenly among `winners` (already in payout order); the odd chips go one each to the first of them. */
export function splitPot(amount: number, winners: readonly string[]): Array<{ playerId: string; amount: number }> {
  const share = Math.floor(amount / winners.length);
  const odd = amount - share * winners.length;
  return winners.map((playerId, i) => ({ playerId, amount: share + (i < odd ? 1 : 0) }));
}

/**
 * Who took the most of a busted seat's chips at a showdown. Each pot it paid into (lowest first,
 * as buildPots lays them out) holds its stake up to that pot's level, shared evenly among the
 * pot's winners: the odd chip of a split decides nothing. Several when they took exactly as much,
 * in the order the pots and their winners come.
 */
export function knockedOutBy(seat: string, pots: ReadonlyArray<{ eligible: readonly string[]; winners: readonly string[] }>, committed: Readonly<Record<string, number>>): string[] {
  const took = new Map<string, number>();
  let below = 0;
  for (const pot of pots) {
    if (!pot.eligible.includes(seat)) break;
    // A pot's level is the smallest stake among those eligible for it.
    const level = Math.min(...pot.eligible.map((id) => committed[id] ?? 0));
    const share = (level - below) / pot.winners.length;
    below = level;
    for (const id of pot.winners) if (id !== seat) took.set(id, (took.get(id) ?? 0) + share);
  }
  const most = Math.max(0, ...took.values());
  return most === 0 ? [] : [...took].filter(([, n]) => most - n < 1e-9).map(([id]) => id);
}
