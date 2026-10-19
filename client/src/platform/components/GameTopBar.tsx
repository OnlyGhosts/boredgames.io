import { Fragment, useState, type ReactNode } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { TABLET_QUERY, useMediaQuery } from '../lib/media';
import { useLive } from '../lib/useLive';
import { registeredGame } from '../registry';
import { selectIsHost } from '../store/selectors';
import { usePlatformStore } from '../store/usePlatformStore';
import { BottomSheet } from './BottomSheet';
import { EndGameButton, EndGameConfirm, EndingNote, ExitActions, LeaveButton, LeaveConfirm, canEndGame, type ExitKind } from './GameExit';
import { MenuIcon, UsersIcon } from './Icons';
import { PlayerChips } from './PlayerChips';
import { PreferenceRows } from './Preferences';
import { RoomCode } from './RoomCode';
import { Logo } from './SiteHeader';
import { Wordmark } from './Wordmark';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Toggle {
  open: boolean;
  onOpen(): void;
}

interface Props {
  meta: GameMeta;
  /** The room: its code for the tiles, its players for the chips. */
  room: RoomState;
  isPhone: boolean;
  testId: string;
  /** The game layout's own class for the bar (its grid placement). */
  className?: string;
  /**
   * Under the game's name: the round, turn or hand (a card table has none: its round is on the
   * table). A status of more than one part (a round and a turn) passes StatusParts, so a narrow
   * bar can stack the parts rather than cut one.
   */
  status?: ReactNode;
  /** Test id and data attributes of the status ('round-indicator' by default). */
  statusTestId?: string;
  statusData?: DataAttrs;
  /** The timer ring, at the end of the players row. */
  clock?: ReactNode;
  /** The players sheet the chips open. */
  players: Toggle & { label?: string };
  /** The phone's options sheet (theme, sound, the game's own rows, End game and Leave room). */
  menu: Toggle;
  /** A desktop or a tablet: in the players row, before the clock (Scribble's word). */
  middle?: ReactNode;
  /** A last row inside the bar (Scribble's word on a phone). */
  below?: ReactNode;
  /**
   * One row only (a card table, whose players are all on the table; The Spy Game on a phone,
   * which lists its players below): the player chips give way to a players button with the
   * count, and the clock, if any, sits small in the row.
   */
  compact?: boolean;
}

/**
 * Every game's top bar: the waiting room's header with the game in it. The logo (its gear "o"
 * the settings button, the logo itself asking before it leaves), the game's name with its status
 * under it, the room code's lime tiles, then the host's End game and everyone's Leave; under that
 * row the player chips, the game's word (Scribble's) and the timer ring.
 * A phone keeps one line: the logo's two phones alone, the name over its status, smaller tiles
 * and the options button, whose sheet has the preferences, End game and Leave room. A tablet's
 * first row is full, so the status moves down to the players row (a card table has none to move),
 * and a card table's "Ending soon", once the host asked, goes under the name.
 */
export function GameTopBar({ meta, room, isPhone, testId, className, status, statusTestId = 'round-indicator', statusData, clock, players, menu, middle, below, compact = false }: Props) {
  const game = registeredGame(room.gameId);
  const meId = useLive(usePlatformStore, (s) => s.playerId);
  const isHost = useLive(usePlatformStore, selectIsHost);
  const tablet = useMediaQuery(TABLET_QUERY);
  // The open confirm step, by the button that opened it: the logo and the bar's Leave share the
  // leave sheet, and only the one pressed reads as open.
  const [exit, setExit] = useState<'brand' | 'leave' | 'end' | null>(null);
  const closeExit = () => setExit(null);
  const leaving = exit === 'brand' || exit === 'leave';
  const hostCanEnd = canEndGame(room, isHost);
  const peopleRow = !compact;
  // A tablet's first row is full: the status goes to the players row, beside the word and the clock.
  const statusBelow = tablet && !isPhone && peopleRow;
  // A card table's tablet bar has no room for the "Ending soon" note beside the code: it goes under the name.
  const endingUnderName = hostCanEnd && Boolean(room.endRequested) && tablet && !isPhone && compact;
  const statusEl =
    status === undefined ? null : (
      <span className="gbar__status" data-testid={statusTestId} {...statusData}>
        {status}
      </span>
    );
  return (
    <>
      <header className={`gbar card${isPhone ? ' gbar--phone' : ''}${compact ? ' gbar--compact' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} data-game={meta.id}>
        <div className="gbar__row">
          <div className="gbar__brand" data-testid="game-brand">
            {isPhone ? <Wordmark variant="icon" /> : <Logo leave={{ open: exit === 'brand', onOpen: () => setExit('brand') }} />}
          </div>
          {!isPhone && <span className="gbar__divider" aria-hidden="true" />}
          <div className="gbar__title">
            <strong className="gbar__name">{meta.name}</strong>
            {!statusBelow && statusEl}
            {endingUnderName && <EndingNote />}
          </div>
          {!peopleRow && middle && <div className="gbar__middle">{middle}</div>}
          <div className="gbar__code">
            <RoomCode code={room.code} testId="game-code" />
          </div>
          <div className="gbar__side">
            {compact && clock && <div className="gbar__clock gbar__clock--row">{clock}</div>}
            {compact && (
              <button
                type="button"
                className="gbar__count"
                onClick={players.onOpen}
                aria-haspopup="dialog"
                aria-expanded={players.open}
                aria-label={`${players.label ?? 'Players'} (${room.players.length})`}
                data-testid="players-toggle"
              >
                <span className="gbar__count-pill">
                  <UsersIcon size={18} />
                  <span className="gbar__count-n">{room.players.length}</span>
                </span>
              </button>
            )}
            {isPhone ? (
              <button type="button" className="icon-btn gbar__btn" onClick={menu.onOpen} aria-haspopup="dialog" aria-expanded={menu.open} aria-label="Options" data-testid="game-menu">
                <MenuIcon size={20} />
              </button>
            ) : (
              <>
                {hostCanEnd && !endingUnderName && <EndGameButton room={room} open={exit === 'end'} onOpen={() => setExit('end')} />}
                <LeaveButton open={exit === 'leave'} onOpen={() => setExit('leave')} />
              </>
            )}
          </div>
        </div>
        {peopleRow && (
          <div className="gbar__people">
            <PlayerChips room={room} game={game} open={players.open} onOpen={players.onOpen} label={players.label ?? 'Players'} />
            {statusBelow && statusEl}
            {middle && <div className="gbar__middle">{middle}</div>}
            {clock && <div className="gbar__clock">{clock}</div>}
          </div>
        )}
        {below}
      </header>
      <BottomSheet open={leaving} title="Leave the room?" hideTitle onClose={closeExit} testId="leave-sheet" className="sheet--exit">
        <LeaveConfirm room={room} meId={meId} onCancel={closeExit} testId="game-leave" />
      </BottomSheet>
      <BottomSheet open={exit === 'end' && hostCanEnd} title="End the game for everyone?" hideTitle onClose={closeExit} testId="end-sheet" className="sheet--exit">
        <EndGameConfirm room={room} onCancel={closeExit} testId="end-game" />
      </BottomSheet>
    </>
  );
}

/** "Round 1/5". */
export function RoundStatus({ round, total }: { round: number; total: number }) {
  return <>{`Round ${round}/${total}`}</>;
}

/**
 * A status of several parts ("Round 1/3", "Turn 2/4"): on one line with a dot between them where
 * the bar has room, stacked one under the other where it has not (the narrowest phones, a phone on
 * its side), so no part is ever cut. The stylesheet draws the dot; a screen reader hears " · ".
 */
export function StatusParts({ parts }: { parts: ReactNode[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sr-only"> · </span>}
          <span className="gbar__part">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The phone's options sheet behind the top bar's menu button: preferences, the game's own rows,
 * then the ways out (End game for the host, Leave room), each behind its confirm step.
 */
export function GameMenuSheet({ open, onClose, children }: { open: boolean; onClose(): void; children?: ReactNode }) {
  const room = useLive(usePlatformStore, (s) => s.room);
  const meId = useLive(usePlatformStore, (s) => s.playerId);
  const isHost = useLive(usePlatformStore, selectIsHost);
  const [confirm, setConfirm] = useState<ExitKind | null>(null);
  const close = () => {
    setConfirm(null);
    onClose();
  };
  // A step whose action went away (the game ended, the host role moved) falls back to the menu.
  const step = confirm === 'end' && !canEndGame(room, isHost) ? null : confirm;
  return (
    // A confirm step's question names it: the sheet's head keeps only the close button then.
    <BottomSheet open={open} title={step === 'end' ? 'End the game for everyone?' : step === 'leave' ? 'Leave the room?' : 'Options'} hideTitle={step !== null} onClose={close} testId="menu-sheet">
      <div className="menu-sheet">
        {step === 'end' ? (
          <EndGameConfirm room={room} onCancel={close} testId="end-game" />
        ) : step === 'leave' ? (
          <LeaveConfirm room={room} meId={meId} onCancel={() => setConfirm(null)} testId="game-leave" />
        ) : (
          <>
            <PreferenceRows />
            {children}
            <ExitActions room={room} isHost={isHost} onPick={setConfirm} />
          </>
        )}
      </div>
    </BottomSheet>
  );
}
