/**
 * A move picked before my turn: while I am in the hand and someone else acts, I can tick Check/Fold,
 * Check (while checking is free for me), Call <amount> (what calling costs right now) or Call any.
 * The pick plays the moment my turn starts. A pick that no longer fits clears itself: Call 200 when
 * the amount to call changes, Check when a bet arrives. Call any and Check/Fold survive the hand.
 */
import type { PokerView } from '@shared/games/poker/protocol';
import { highestBet } from '../hooks';

export type PremoveKind = 'checkFold' | 'check' | 'call' | 'callAny';

export interface Premove {
  kind: PremoveKind;
  /** The hand it was picked in: a new hand clears it. */
  hand: number;
  /** Call: the amount it calls. */
  amount?: number;
}

/** What a pick may be right now: null when I cannot pick (not in the hand, folded, all in, or my turn). */
export function premoveWindow(view: PokerView | null, meId: string | null): { toCall: number; canCheck: boolean } | null {
  if (!view || meId === null || view.phase !== 'acting' || view.turn === null || view.turn === meId) return null;
  const seat = view.players[meId];
  if (!seat || !view.order.includes(meId) || seat.status !== 'waiting' || seat.chips <= 0) return null;
  const toCall = Math.min(Math.max(0, highestBet(view) - seat.bet), seat.chips);
  return { toCall, canCheck: toCall === 0 };
}

/** The pick as it stands after this snapshot: kept, or null once it no longer fits. */
export function keepPremove(pick: Premove | null, view: PokerView | null, meId: string | null): Premove | null {
  if (!pick || !view || meId === null || view.hand !== pick.hand || view.phase !== 'acting') return null;
  // My turn: the pick plays against my own actions (see premoveMove).
  if (view.turn === meId) return pick;
  const w = premoveWindow(view, meId);
  if (!w) return null;
  if (pick.kind === 'check' && !w.canCheck) return null;
  if (pick.kind === 'call' && w.toCall !== pick.amount) return null;
  return pick;
}

/** On my turn, the move the pick plays: null when it no longer fits (it is dropped). */
export function premoveMove(pick: Premove, view: PokerView): 'check' | 'call' | 'fold' | null {
  const a = view.actions;
  switch (pick.kind) {
    case 'checkFold':
      return a.canCheck ? 'check' : a.canFold ? 'fold' : null;
    case 'check':
      return a.canCheck ? 'check' : null;
    case 'call':
      return a.canCall && a.callAmount === pick.amount ? 'call' : null;
    case 'callAny':
      return a.canCall ? 'call' : a.canCheck ? 'check' : null;
  }
}
