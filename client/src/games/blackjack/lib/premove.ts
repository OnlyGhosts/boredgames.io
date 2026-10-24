/**
 * A move picked before my turn: while I am dealt in and others play their hands, Hit, Stand,
 * Double or Split can be tapped ahead. The pick plays the moment my first hand's turn starts if it
 * is still legal then (Split only with a pair, Double only on two cards); otherwise it is dropped
 * without a word. It never carries over to a split hand, and a round or hand's end clears it.
 */
import type { BlackjackActions, BlackjackView } from '@shared/games/blackjack/protocol';

export type PremoveKind = 'hit' | 'stand' | 'double' | 'split';

export interface Premove {
  kind: PremoveKind;
  /** The round it was picked in. */
  round: number;
}

const ACTION: Record<PremoveKind, keyof BlackjackActions> = {
  hit: 'canHit',
  stand: 'canStand',
  double: 'canDouble',
  split: 'canSplit',
};

/** Whether I can pick now: the hands are in play, mine is dealt and waiting, and the turn is someone else's. */
export function canPremove(view: BlackjackView | null, meId: string | null): boolean {
  if (!view || meId === null || view.phase !== 'acting' || !view.turn || view.turn.playerId === meId) return false;
  const seat = view.players[meId];
  return !!seat && seat.inRound && seat.hands.length > 0 && seat.hands[0].status === 'waiting';
}

/** What the pick does with this snapshot: keep waiting, play its move, or drop it. */
export function premoveStep(pick: Premove | null, view: BlackjackView, meId: string | null): 'keep' | 'play' | 'drop' {
  if (!pick || meId === null) return 'drop';
  if (view.round !== pick.round || view.phase !== 'acting' || !view.turn) return 'drop';
  if (view.turn.playerId === meId) return view.turn.handIndex === 0 && view.actions[ACTION[pick.kind]] ? 'play' : 'drop';
  return canPremove(view, meId) ? 'keep' : 'drop';
}
