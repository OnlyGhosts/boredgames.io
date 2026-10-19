import type { GameRules } from '../game';
import { noOrphan } from './format';

export type RulesSectionKey = 'round' | 'scoring' | 'end' | 'settings' | 'watchers';

/** The colour of a section's tab pill: the game's accent for the round, then lime, warm, lilac and a muted blue. */
export type RulesTone = 'accent' | 'lime' | 'warm' | 'lilac' | 'muted';

export interface RulesSection {
  key: RulesSectionKey;
  heading: string;
  tone: RulesTone;
  text: string;
}

/** The five sections of a How to play card, in reading order, with the headings and pill colours every game shares. */
export function rulesSections(rules: GameRules): RulesSection[] {
  return [
    { key: 'round', heading: rules.unit === 'hand' ? 'How a hand goes' : 'How a round goes', tone: 'accent', text: rules.round },
    { key: 'scoring', heading: 'How you score', tone: 'lime', text: rules.scoring },
    { key: 'end', heading: 'How it ends', tone: 'warm', text: rules.end },
    { key: 'settings', heading: 'What the settings change', tone: 'lilac', text: rules.settings },
    { key: 'watchers', heading: 'Watching', tone: 'muted', text: rules.watchers },
  ];
}

/** "Join mid‑game and you watch until the next game.": what the platform does for every game ("mid‑game" with a no-break hyphen, so it never splits at a line's end). */
export const JOIN_MID_GAME_TEXT = 'Join mid\u2011game and you watch until the next game.';

/** A number (thousands commas or a decimal point inside it) and the bracket closing after it, if any, then a space, and "to " when that comes next. */
const NUMBER_THEN_SPACE = /(\d(?:[\d,.]*\d)?\)?) (to )?(?=\S)/g;

/**
 * Rules prose as the card sets it, so no line ends on a split that reads wrong: a number keeps the
 * word after it ("4 points", "(3 on", "2 or more"), and a number before "to" keeps both words after
 * it ("1 to 10", "2 to the spy"); a hyphenated word never breaks at its hyphen ("No‑limit"); and the
 * last two words stay together (noOrphan). No-break spaces and hyphens only: the text reads the same.
 */
export function rulesProse(text: string): string {
  const bound = text.replace(NUMBER_THEN_SPACE, (_, number: string, to?: string) => `${number}\u00a0${to ? 'to\u00a0' : ''}`).replace(/(\p{L})-(?=\p{L})/gu, '$1\u2011');
  return noOrphan(bound);
}
