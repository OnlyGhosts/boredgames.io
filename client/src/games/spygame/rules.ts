/** The Spy Game's How to play, written from the server's rules; every number is the shared constant. */
import {
  SPYGAME_CANDIDATES,
  SPYGAME_GUESSES,
  SPYGAME_POINTS as P,
  SPYGAME_ROUND_MINUTES,
  SPYGAME_SETTINGS_LIMITS as L,
  SPYGAME_VOTE_SECONDS,
} from '@shared/games/spygame/protocol';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const spygameRules: GameRules = {
  summary: 'Find the spy before they find the place.',
  // The place card the agents see beside the spy's "?" card; the round clock as the badge.
  hero: { kind: 'place', badge: `${SPYGAME_ROUND_MINUTES} min` },
  facts: [
    { label: 'Round clock', value: `${SPYGAME_ROUND_MINUTES} min`, note: 'Quiz each other without giving it away' },
    { label: 'Spy sees', value: `${SPYGAME_CANDIDATES} places`, note: 'The agents see the real one' },
    { label: 'Spy guesses', value: `${SPYGAME_GUESSES}`, note: 'Wrong twice and the agents win' },
    { label: 'Vote', value: `${SPYGAME_VOTE_SECONDS} s`, note: 'No vote counts as No' },
  ],
  // The clocks, the candidates and the guesses sit in the facts above.
  round: 'Each round has one spy. The others see the place, the spy only the list of candidates. Quiz each other without giving it away. An agent can accuse once a round: the clock pauses while the other agents vote, and a tie fails.',
  scoring: `The spy names the place: ${P.spyFirstGuess} points (${P.spySecondGuess} on the second guess). Wrong person voted out: ${P.wrongAccusation} to the spy. Spy caught, wrong twice or time up: ${P.agentWin} to each agent, plus ${P.accuserBonus} to the accuser.`,
  end: 'After the last round, or when the host ends it. Most points wins.',
  settings: `Rounds (${L.rounds.min} to ${L.rounds.max}). Unhinged mode plays adult places.`,
  watchers: `Miss a round’s start and you watch. ${JOIN_MID_GAME_TEXT}`,
};
