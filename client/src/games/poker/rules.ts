/** Poker's How to play, written from the server's rules; every number is the shared constant. */
import { POKER_ACT_SECONDS } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const pokerRules: GameRules = {
  unit: 'hand',
  summary: 'No-limit Texas Hold’em, best five of seven cards.',
  // Pocket aces, the hole cards everyone hopes for, with the move that puts the stack in the middle.
  hero: { kind: 'cards', cards: ['AH', 'AD'], badge: 'All in' },
  facts: [
    { label: 'Hole cards', value: '2', note: 'Private; five more are shared' },
    { label: 'Big blind', value: '2x small', note: 'Blinds rotate with the button' },
    { label: 'To act', value: `${POKER_ACT_SECONDS} s`, note: 'Else you check or fold' },
    { label: 'Showdown', value: 'Best 5 of 7', note: 'Ties split the pot' },
  ],
  // The blinds, the clock and the showdown sit in the facts above.
  round: 'Two private cards each, then betting before the flop and after the flop, turn and river: fold, check, call, bet, raise or all in. Betting ends once everyone has matched or is all in.',
  scoring: 'If everyone else folds, the last player takes the pot. Otherwise the best hand at the showdown wins.',
  end: 'Out of chips and you watch. It ends when one player has every chip, after the set hands, or at the host’s word. Most chips wins.',
  settings: 'Starting chips, the small blind, how often blinds double and how many hands to play.',
  watchers: `The table seats ${gameById('poker').maxPlayers}; extras wait for a seat. ${JOIN_MID_GAME_TEXT}`,
};
