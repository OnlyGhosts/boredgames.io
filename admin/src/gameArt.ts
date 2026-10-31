import type { ComponentType } from 'react';
import type { GameId } from '@shared/platform/games';
import { BlackjackArt } from '../../client/src/games/blackjack/art';
import { PokerArt } from '../../client/src/games/poker/art';
import { QuipgameArt } from '../../client/src/games/quipgame/art';
import { ScribbleArt } from '../../client/src/games/scribble/art';
import { SpygameArt } from '../../client/src/games/spygame/art';
import { ClickRaceArt } from '../../client/src/games/template/art';

/**
 * Each game's lobby-tile picture, for its rooms on the Live rooms page. Only the art files: the
 * game modules would bring their screens, sounds and stores into the admin bundle.
 */
export const GAME_ART: Record<GameId, ComponentType> = {
  scribble: ScribbleArt,
  spygame: SpygameArt,
  quipgame: QuipgameArt,
  blackjack: BlackjackArt,
  poker: PokerArt,
  template: ClickRaceArt,
};
