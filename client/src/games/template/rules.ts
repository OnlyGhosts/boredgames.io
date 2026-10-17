/** Click Race's How to play: the template of a rules module, written from the server's rules. */
import { TEMPLATE_SETTINGS_LIMITS as L } from '@shared/games/template/protocol';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const templateRules: GameRules = {
  summary: 'Tap the big button faster than everyone else.',
  // The glyph on its plate: the hero a game starts with until it has an illustration of its own (platform/game.ts lists the kinds).
  hero: { kind: 'glyph' },
  // Exactly four tiles: a short label, a value of at most 12 characters, a note; every number from the shared constants.
  facts: [
    { label: 'Target', value: `${L.targetClicks.min} to ${L.targetClicks.max}`, note: 'Taps to win' },
    { label: 'Clock', value: `${L.timeLimit.min} to ${L.timeLimit.max} s`, note: 'The race ends when it runs out' },
    { label: 'First to target', value: 'Bonus', note: 'For reaching it before everyone else' },
    { label: 'Everyone else', value: '1 per tap', note: 'Scored when the race ends' },
  ],
  round: 'Everyone taps at once. The race ends when someone reaches the target or the clock runs out.',
  scoring: 'The first to the target wins a bonus. Everyone else scores a point per tap when the race ends.',
  end: 'After the one race. Most points wins.',
  settings: `The target (${L.targetClicks.min} to ${L.targetClicks.max} taps) and the clock (${L.timeLimit.min} to ${L.timeLimit.max} seconds).`,
  watchers: JOIN_MID_GAME_TEXT,
};
