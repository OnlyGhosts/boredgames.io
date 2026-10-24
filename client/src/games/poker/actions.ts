import type { PokerActions, PokerMoveTarget, PokerView } from '@shared/games/poker/protocol';
import { socket } from '../../platform/net/socket';
import { isMyTurn } from './hooks';
import { keepPremove, premoveMove } from './lib/premove';
import { usePokerStore } from './store';

/** What a move answers, as my screen has it: the hand and the latest move on the table. A tap that lands after the turn moved on does nothing. */
export function moveTarget(view: PokerView): PokerMoveTarget {
  return { hand: view.hand, move: view.lastMove?.seq ?? 0 };
}

/** Sends a move aimed at the turn on my screen, and holds the moves until the table answers. */
function send(view: PokerView, msg: { t: 'fold' | 'check' | 'call' | 'allIn' } | { t: 'bet'; amount: number } | { t: 'raise'; to: number }): boolean {
  const sent = socket.send({ ...msg, ...moveTarget(view) });
  if (!sent) return false;
  const store = usePokerStore.getState();
  store.newTurn();
  store.markPending(msg.t, view);
  return true;
}

export const fold = (view: PokerView): boolean => send(view, { t: 'fold' });
export const check = (view: PokerView): boolean => send(view, { t: 'check' });
export const call = (view: PokerView): boolean => send(view, { t: 'call' });
export const allIn = (view: PokerView): boolean => send(view, { t: 'allIn' });

/**
 * The Bet / Raise button: a bet of `amount` when nobody has bet, a raise to `amount` otherwise;
 * the whole stack goes as an all in so a short stack never trips the minimum.
 */
export function wager(view: PokerView, actions: PokerActions, amount: number): boolean {
  if (actions.canBet) return amount >= actions.maxBet ? allIn(view) : send(view, { t: 'bet', amount });
  if (actions.canRaise) return amount >= actions.maxRaiseTo ? allIn(view) : send(view, { t: 'raise', to: amount });
  return false;
}

/**
 * A new snapshot: the pick made before my turn clears once it no longer fits, and plays the moment
 * my turn starts (while no move of mine is waiting). A send that fails (the socket is down) keeps it
 * for the next snapshot of my turn, so a turn that came while the app was away still plays it.
 */
export function playPremove(view: PokerView, meId: string | null): void {
  const store = usePokerStore.getState();
  const pick = keepPremove(store.premove, view, meId);
  if (pick !== store.premove) store.setPremove(pick);
  if (!pick || !isMyTurn(view, meId) || store.pending !== null) return;
  const move = premoveMove(pick, view);
  if (move === null) {
    store.setPremove(null);
    return;
  }
  if (send(view, { t: move })) usePokerStore.getState().setPremove(null);
}
