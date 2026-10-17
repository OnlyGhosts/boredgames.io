/** Blackjack's How to play, written from the table rules; every number is the shared constant. */
import { BLACKJACK, DEALER_STANDS_AT, NATURAL_PAYOUT } from '@shared/games/blackjack/cards';
import { BLACKJACK_SETTINGS_LIMITS as L } from '@shared/games/blackjack/protocol';
import type { GameRules } from '../../platform/game';
import { thousands } from '../../platform/lib/format';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const blackjackRules: GameRules = {
  unit: 'hand',
  summary: `Beat the dealer without going over ${BLACKJACK}.`,
  // An ace and a king fanned: the natural, with the goal as the badge.
  hero: { kind: 'cards', cards: ['AS', 'KH'], badge: `${BLACKJACK}` },
  facts: [
    { label: 'Goal', value: `${BLACKJACK}`, note: 'Beat the dealer, don’t go over' },
    { label: 'Bust', value: `Over ${BLACKJACK}`, note: 'Loses even if the dealer busts' },
    { label: 'Dealer', value: `Stands on ${DEALER_STANDS_AT}`, note: `Draws to ${DEALER_STANDS_AT - 1}` },
    { label: 'Blackjack pays', value: `${NATURAL_PAYOUT.wins} to ${NATURAL_PAYOUT.stake}`, note: 'Rounded down' },
  ],
  // The bust and the dealer's play sit in the facts above.
  round: 'Bet 1 chip to your whole stack, or sit out. Cards go out once all have bet. Ace or ten up, the dealer checks for blackjack, which ends the hand. Then hit, stand, double your first two cards for one more, or split a pair (again while chips last; split aces get one card).',
  scoring: 'Beat the dealer to win your bet. A tie returns your bet. A bust loses even if the dealer busts.',
  end: 'Out of chips, you watch. It ends with one stack left, or none, or at the host’s word, after the hand. Most chips wins.',
  settings: `Starting chips (${thousands(L.startingChips.min)} to ${thousands(L.startingChips.max)}).`,
  watchers: JOIN_MID_GAME_TEXT,
};
