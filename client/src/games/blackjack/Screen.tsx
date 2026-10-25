import type { BlackjackSettings, BlackjackView } from '@shared/games/blackjack/protocol';
import { gameById } from '@shared/platform/games';
import { PlayerList } from '../../platform/components/PlayerList';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { useActiveGame } from '../../platform/store/selectors';
import { TableShell } from '../../platform/table/TableShell';
import { ControlPanel } from './components/ControlPanel';
import { Table } from './components/Table';
import { isActing, nameOf, useConnected, useRejoining, useTableNow } from './hooks';
import { focusOf } from './lib/focus';
import { tableOf, type TableModel } from './lib/table';
import { animating, frameAt, myHandLanded, outcomesShown, snapTimeline, stackOnScreen, viewOnScreen } from './lib/timeline';
import { standingOf } from './lib/text';
import { useBlackjack } from './store';

const meta = gameById('blackjack');

/**
 * The Blackjack table on the platform's table shell: the top bar (the game, players, options), the control
 * panel (left on a desktop, docked at the bottom on a phone) and the calm table (the dealer, the
 * banner with whose turn it is, every other player as a compact seat, the stage with the hands
 * that matter to me). Nothing runs on a clock: the bets and the turns wait for the players. The
 * cards move by the timeline the store plans from the snapshots; a settled table stays up through
 * the dealer's reveal and on through the next bets, and the final one a short beat more (saying
 * "Game over") before the results.
 */
export function BlackjackScreen({ room, meId, isHost }: GameScreenProps<BlackjackView, BlackjackSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const connected = useConnected();
  const rejoining = useRejoining();
  const pending = useBlackjack((s) => s.pending);
  const queued = useBlackjack((s) => s.queuedBet !== null);
  const sheet = useBlackjack((s) => s.sheet);
  const openSheet = useBlackjack((s) => s.openSheet);
  const stored = useBlackjack((s) => s.timeline);
  const table = tableOf(room.game);
  // A timeline planned for another table (a render before the store caught up) shows the truth.
  const timeline = stored.id === (table?.round ?? null) || stored.discard ? stored : snapTimeline(table, 0);
  const now = useTableNow(timeline);
  if (!room.game) return null;
  // Who went out of chips waits for the reveal, like the stacks.
  const view = viewOnScreen(room.game, table, timeline, now);
  const shown = view === room.game ? room : { ...room, game: view };

  const frame = frameAt(timeline, table, now);
  const playing = room.phase === 'playing';
  const held = Boolean(room.waiting) || view.phase === 'held';
  const myTurn = isActing(view, meId);
  const turnName = nameOf(shown, view.turn?.playerId);
  const seat = view.players[meId];
  // Every stack on screen holds its pre-settle count until the round's outcomes show.
  const chipsOf = (id: string) => stackOnScreen(table, timeline, id, view.players[id]?.chips ?? 0, now);
  const busy = animating(timeline, now);
  // The settled round's reveal is still playing: every part of the screen says it is the dealer's turn.
  const dealerPlaying = Boolean(frame.table?.settled) && !outcomesShown(frame.timeline, now);
  // My moves wait only for my own cards and the dealer's up card, not for the whole deal to land.
  const movesReady = myTurn && view.turn !== null && myHandLanded(timeline, table, meId, view.turn.handIndex, now);
  const standing = standingOf({
    phase: view.phase,
    seated: seat !== undefined,
    bustedOut: seat?.bustedOut ?? false,
    inRound: view.order.includes(meId),
    hasChips: (seat?.chips ?? 0) + (seat?.bet ?? 0) > 0,
    sittingOut: seat?.sittingOut ?? false,
  });
  const betSent = pending?.kind === 'bet' || queued;
  const focus = focusOf({ view, table: frame.table, dealerPlaying, outcomesShown: outcomesShown(frame.timeline, now), meId, betSent });
  const line = { standing, turnAway: view.turn !== null && (view.away ?? []).includes(view.turn.playerId), betQueued: queued };

  return (
    <TableShell
      meta={meta}
      className="bj"
      testId="blackjack-screen"
      headerTestId="blackjack-header"
      mainTestId="blackjack-main"
      data={{ 'data-phase': view.phase, 'data-round': view.round, 'data-turn-player': view.turn?.playerId, 'data-turn-hand': view.turn?.handIndex, 'data-busy': busy }}
      isPhone={isPhone}
      room={shown}
      players={<PlayerList room={shown} meId={meId} isHost={isHost} mode="game" game={game} />}
      sheet={sheet}
      onSheet={openSheet}
      table={<Table room={shown} view={view} meId={meId} truth={table} frame={frame} now={now} isPhone={isPhone} focus={focus} line={line} chipsOf={chipsOf} />}
      panel={
        <ControlPanel
          room={shown}
          view={view}
          meId={meId}
          balance={chipsOf(meId)}
          watching={standing === 'watching'}
          canSend={playing && connected && !rejoining && !held}
          movesReady={movesReady}
          dealerPlaying={dealerPlaying}
          pending={pending}
          queued={queued}
          turnName={turnName}
          hotkeys={!isPhone}
        />
      }
    />
  );
}
