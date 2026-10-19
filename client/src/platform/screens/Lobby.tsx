import { useEffect, useRef, useState } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { NAME_MAX_LENGTH } from '@shared/platform/constants';
import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { SITE_NAME } from '@shared/platform/site';
import { AvatarPicker } from '../components/AvatarPicker';
import { BottomSheet } from '../components/BottomSheet';
import { GamePicker } from '../components/GamePicker';
import { LeaveConfirm } from '../components/GameExit';
import { ChevronIcon, CopyIcon, EditIcon, LogoutIcon, PlayIcon, ShareIcon } from '../components/Icons';
import { PlayerList } from '../components/PlayerList';
import { ReadyControls } from '../components/ReadyControls';
import { RoomCode } from '../components/RoomCode';
import { SettingsPanel } from '../components/SettingsPanel';
import { SiteHeader } from '../components/SiteHeader';
import type { AnyGameClientModule } from '../game';
import { copyText } from '../lib/clipboard';
import { COLUMNS_QUERY, PHONE_QUERY, useMediaQuery } from '../lib/media';
import { canStart, listNames, notReadyPlayers, readyLine, readyPlayers } from '../lib/party';
import { useListRoom } from '../lib/useListRoom';
import { useLive } from '../lib/useLive';
import { startGame, updateProfile } from '../net/actions';
import { inviteLink } from '../router';
import { selectIsHost, selectMe } from '../store/selectors';
import { usePlatformStore } from '../store/usePlatformStore';

interface Props {
  room: RoomState;
  game: AnyGameClientModule | null;
}

export function Lobby({ room, game }: Props) {
  const me = useLive(usePlatformStore, selectMe);
  const isHost = useLive(usePlatformStore, selectIsHost);
  const playerId = useLive(usePlatformStore, (s) => s.playerId);
  const addToast = usePlatformStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The host's "Start anyway" step: kept here, so it outlives the controls moving between the
  // column and a phone's footer (a tablet turned, a window resized), which remounts them.
  const [confirming, setConfirming] = useState(false);
  // The two-column room (a tablet or a desktop, never a phone turned sideways): Start and the row
  // under it sit under the player list; a phone pins them to the bottom of the screen instead. The
  // list shows every player while the page holds it with them; a bigger party scrolls inside it, in
  // whole rows with a faded peek of the next and "+N more" (useListRoom).
  const twoColumns = useMediaQuery(COLUMNS_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);
  const columns = twoColumns && !phone;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const list = useListRoom(rootRef, '[data-testid="player-list"]', columns ? '.lobby__actions' : '.lobby__footer', !columns);
  const fade = [list.above && 'top', list.below > 0 && 'bottom'].filter(Boolean).join(' ');
  const meta = gameById(room.gameId);

  // The home page was likely scrolled to its join form (or the game was): start the lobby at the code.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const host = room.players.find((p) => p.id === room.hostId);
  const changeLook = (
    <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)} aria-haspopup="dialog" aria-expanded={editing} data-testid="edit-profile">
      <EditIcon size={18} /> Change my look
    </button>
  );
  const link = inviteLink(meta, room.code);

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    addToast(ok ? 'success' : 'error', ok ? `${label} copied` : `Couldn’t copy the ${label.toLowerCase()}. Select it and copy it yourself.`);
  };

  /** The native share sheet where it exists (phones); otherwise the link lands on the clipboard. */
  const share = async () => {
    const data: ShareData = { title: SITE_NAME, text: `Join my room on ${SITE_NAME}. Code: ${room.code}.`, url: link };
    if (typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // the user closed the sheet
      }
    }
    await copy(link, 'Invite link');
  };

  const controls = (
    <>
      {isHost && <StartControls room={room} confirming={confirming} onConfirming={setConfirming} />}
      {me && <ReadyControls me={me} extra={changeLook} />}
      {!isHost && (
        <p className="lobby__waiting" data-testid="waiting-for-host">
          Waiting for {host?.name ?? 'the host'} to start {meta.name}
          <span className="ellipsis" aria-hidden="true" />
        </p>
      )}
    </>
  );

  return (
    <div className={`lobby${isHost ? '' : ' lobby--guest'}${columns ? ' lobby--columns' : ''}`} ref={rootRef} data-testid="lobby">
      <div className="lobby__body">
        {/* The room's header: one bar holding the logo, the code and its buttons on a wider screen; a phone stacks the logo over the code card. */}
        <div className="lobby__top">
          <SiteHeader />

          <section className="room-card" aria-label="Room code" data-testid="room-bar">
            <div className="room-card__code">
              <RoomCode code={room.code} testId="room-code" />
            </div>
            <button type="button" className="room-card__btn" onClick={() => void copy(room.code, 'Code')} aria-label="Copy code" data-testid="copy-code">
              <CopyIcon size={20} />
              <span>Copy</span>
            </button>
            <button type="button" className="room-card__btn" onClick={() => void share()} aria-label="Share invite" data-testid="share-invite">
              <ShareIcon size={20} />
              <span>Share</span>
            </button>
            <button type="button" className="room-card__btn" onClick={() => setLeaving(true)} aria-haspopup="dialog" aria-expanded={leaving} aria-label="Leave room" data-testid="leave-room">
              <LogoutIcon size={20} />
              <span>Leave</span>
            </button>
          </section>
        </div>

        {/* Only the host sees the settings: everyone else sees what is next, who is here and their own buttons. */}
        <div className={`lobby__grid${isHost ? '' : ' lobby__grid--guest'}`}>
          <div className="lobby__col">
            <GamePicker room={room} isHost={isHost} game={game} />

            <section className="lobby__players" aria-labelledby="players-heading">
              <h2 className="sr-only" id="players-heading">
                Players
              </h2>
              <span className="sr-only" data-testid="player-count" data-ready={readyPlayers(room).length} data-players={room.players.length}>
                {readyLine(room)}
              </span>
              <div className="lobby__list" data-capped={list.capped} data-fade={fade || undefined}>
                <PlayerList room={room} meId={playerId} isHost={isHost} mode="lobby" game={game} />
                {/* The rows the box hides under its foot; the list itself is read out whole, so the pill is for the eye only. */}
                {list.below > 0 && (
                  <span className="lobby__more" aria-hidden="true" data-testid="player-list-more">
                    +{list.below} more <ChevronIcon size={14} strokeWidth={2.4} />
                  </span>
                )}
              </div>
            </section>

            {columns && (
              <div className="lobby__controls lobby__actions" data-testid="lobby-actions">
                {controls}
              </div>
            )}
          </div>

          {isHost && (
            <div className="lobby__col">
              <section className="card lobby__settings" aria-labelledby="settings-heading">
                <div className="card__head">
                  <h2 className="card__title" id="settings-heading">
                    Settings
                  </h2>
                </div>
                <SettingsPanel room={room} game={game} />
              </section>
            </div>
          )}
        </div>
      </div>

      {!columns && (
        <div className="lobby__footer" data-testid="lobby-footer">
          <div className="lobby__controls lobby__footer-inner">{controls}</div>
        </div>
      )}

      <BottomSheet open={leaving} title="Leave the room?" hideTitle onClose={() => setLeaving(false)} testId="lobby-leave-sheet" className="sheet--exit">
        <LeaveConfirm room={room} meId={playerId} onCancel={() => setLeaving(false)} testId="lobby-leave" />
      </BottomSheet>

      {me && (
        <BottomSheet open={editing} title="Change my look" onClose={() => setEditing(false)} testId="profile-sheet" className="sheet--narrow sheet--dialog">
          <ProfileEditor me={{ name: me.name, avatar: me.avatar }} onClose={() => setEditing(false)} />
        </BottomSheet>
      )}
    </div>
  );
}

interface StartProps {
  room: RoomState;
  /** The "Start anyway" step is showing. */
  confirming: boolean;
  onConfirming(on: boolean): void;
}

/**
 * The host's Start: enabled once enough players are ready, with a hint naming who still is not.
 * Starting while some could still ready up asks first, since they would sit the game out.
 */
function StartControls({ room, confirming, onConfirming }: StartProps) {
  const meta = gameById(room.gameId);
  const ready = readyPlayers(room).length;
  const notReady = notReadyPlayers(room);
  const startable = canStart(room, meta);
  useEffect(() => {
    if (notReady.length === 0) onConfirming(false);
  }, [notReady.length, onConfirming]);

  const onStart = () => {
    if (notReady.length > 0 && !confirming) {
      onConfirming(true);
      return;
    }
    onConfirming(false);
    startGame();
  };

  return (
    <>
      {confirming ? (
        <div className="start-confirm" role="group" aria-label="Start with players not ready" data-testid="start-confirm">
          <p className="start-confirm__text">
            {listNames(notReady.map((p) => p.name))} {notReady.length === 1 ? "isn’t" : "aren’t"} ready yet and would sit this one out.
          </p>
          <div className="start-confirm__actions">
            <button type="button" className="btn btn--primary" onClick={onStart} data-testid="start-anyway">
              <PlayIcon size={16} /> Start anyway
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => onConfirming(false)} data-testid="start-wait">
              Wait for them
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onStart} disabled={!startable} data-testid="start-game" data-ready={ready}>
          {/* Short of players, the button says what it waits for (the rows above say who), so nothing under it comes and goes. */}
          {startable ? `Start · ${ready} ready` : `Start · ${ready} ready, needs ${meta.minPlayers}`}
        </button>
      )}
    </>
  );
}

function ProfileEditor({ me, onClose }: { me: { name: string; avatar: AvatarData }; onClose(): void }) {
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const clean = name.replace(/\s+/g, ' ').trim();
  return (
    <div className="profile-editor" data-testid="profile-editor">
      <div className="field">
        <label className="field__label" htmlFor="lobby-name">
          Name
        </label>
        <input
          id="lobby-name"
          className="input"
          type="text"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="nickname"
          autoCorrect="off"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <AvatarPicker value={avatar} onChange={setAvatar} compact />
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={!clean}
        onClick={() => {
          updateProfile(clean !== me.name ? clean : undefined, avatar);
          onClose();
        }}
        data-testid="save-profile"
      >
        Save
      </button>
    </div>
  );
}
