import type { GameRules } from '../game';

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

/** "Join mid-game and you watch until the next game.": what the platform does for every game. */
export const JOIN_MID_GAME_TEXT = 'Join mid-game and you watch until the next game.';
