/** Quip Game's How to play, written from the server's rules; every number is the shared constant. */
import {
  QUIPGAME_MAX_PICKS,
  QUIPGAME_POINTS as P,
  QUIPGAME_REGULAR_ROUNDS,
  QUIPGAME_SETTINGS_LIMITS as L,
  QUIPGAME_VOTE_SECONDS,
  QUIPGAME_WRITE_SECONDS,
} from '@shared/games/quipgame/protocol';
import type { GameRules } from '../../platform/game';
import { thousands } from '../../platform/lib/format';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

const [first, second, third] = P.finalPicks;

export const quipgameRules: GameRules = {
  summary: 'Write the funniest answer. The room votes.',
  // Two answers head to head, one taking the votes; the writing clock as the badge.
  hero: { kind: 'quips', badge: `${QUIPGAME_WRITE_SECONDS} s` },
  facts: [
    { label: 'Write', value: `${QUIPGAME_WRITE_SECONDS} s`, note: 'Two prompts a round, one in the final' },
    { label: 'Vote', value: `${QUIPGAME_VOTE_SECONDS} s`, note: 'The writers stay hidden' },
    { label: 'A matchup', value: thousands(P.pool), note: 'Split by votes; double in round two' },
    { label: 'Flawless', value: `+${P.flawless}`, note: `Take every vote, ${P.flawlessMinVotes} or more` },
  ],
  // The clocks, the matchup pool and the flawless bonus sit in the facts above.
  round: `The first ${QUIPGAME_REGULAR_ROUNDS} rounds give two prompts to answer. Each prompt then goes head to head: two answers, writers hidden, the others vote and an announcer reads them out. In the final, everyone answers one prompt and ranks ${QUIPGAME_MAX_PICKS} favourites, never their own.`,
  scoring: `A matchup splits its points between the two writers by votes. Round two pays double, the flawless bonus included. In the final, each voter’s picks pay ${thousands(first)}, ${thousands(second)} and ${thousands(third)}.`,
  end: 'After the final, or when the host ends it. Most points wins.',
  settings: `Custom prompts join the pack, or replace it with ${L.customPrompts.minForOnly} or more. Unhinged mode plays adult prompts.`,
  watchers: `Miss a round’s start and you still vote. ${JOIN_MID_GAME_TEXT}`,
};
