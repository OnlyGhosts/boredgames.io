/** Scribble's How to play, written from the server's rules; every number is the shared constant. */
import { CHOOSE_TIME_SECONDS } from '@shared/games/scribble/constants';
import { SCRIBBLE_DRAW_SECONDS, SCRIBBLE_SETTINGS_LIMITS as L } from '@shared/games/scribble/protocol';
import { drawerPoints, guesserPoints } from '@shared/games/scribble/scoring';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const scribbleRules: GameRules = {
  summary: 'Draw a word and guess everyone else’s.',
  // A doodle on the canvas with the pencil over it; the drawing clock as the badge.
  hero: { kind: 'canvas', badge: `${SCRIBBLE_DRAW_SECONDS} s` },
  facts: [
    { label: 'Pick a word', value: `${CHOOSE_TIME_SECONDS} s`, note: 'Else the first' },
    { label: 'Draw it', value: `${SCRIBBLE_DRAW_SECONDS} s`, note: 'Others type guesses' },
    { label: 'Right guess', value: `${guesserPoints(1, 1)}`, note: `Sliding to ${guesserPoints(0, 1)} at the last second` },
    { label: 'Drawer', value: `${drawerPoints(1, 1)}`, note: 'Up to, scaled by guessers who got it' },
  ],
  // The clocks and the points sit in the facts above.
  round: 'Everyone draws once per round. The drawer picks a word and draws it while the others type guesses. Hints appear as the clock runs. The turn ends when everyone has guessed or time is up.',
  scoring: 'A right guess pays more the sooner it comes; the drawer earns more the more guessers get it.',
  end: 'After the last round, or when the host ends it. Most points wins.',
  settings: `Rounds (${L.rounds.min} to ${L.rounds.max}), hints per word (${L.hints.min} to ${L.hints.max}, at most half the letters) and words to choose from (${L.wordChoices.min} to ${L.wordChoices.max}). Custom words join the list, or replace it with ${L.customWords.minForOnly} or more. Unhinged mode plays adult words.`,
  watchers: JOIN_MID_GAME_TEXT,
};
