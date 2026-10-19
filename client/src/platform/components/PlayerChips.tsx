import { useLayoutEffect, useRef, useState } from 'react';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule, PlayerStatus } from '../game';
import { Avatar } from './Avatar';
import { CheckIcon, EyeIcon, MoonIcon } from './Icons';

/** The size of the icon in a chip's status badge; games pass it to their own icons. */
export const CHIP_ICON = { size: 9, strokeWidth: 2.8 } as const;

/**
 * A chip's two looks, in px: named (the avatar, the name and the status), `w` wide where the row
 * has room and never under `min`; and a face (the avatar alone, its status a badge on its corner),
 * `faceW` wide and never under `faceMin`; each with its gap. The stylesheet's custom properties on
 * the row (`--chip-w`, `--chip-min`, `--chip-gap`, `--chip-face-w`, `--chip-face-min`,
 * `--chip-face-gap`) say otherwise.
 */
export interface ChipSizes {
  w: number;
  min: number;
  gap: number;
  faceW: number;
  faceMin: number;
  faceGap: number;
}

export const CHIP_SIZES: ChipSizes = { w: 64, min: 60, gap: 6, faceW: 44, faceMin: 40, faceGap: 4 };

/** Players taking part first, then the ones sitting it out; join order inside each group. */
export function chipOrder(players: readonly PlayerPublic[]): PlayerPublic[] {
  return players.slice().sort((a, b) => Number(b.participating) - Number(a.participating) || a.joinOrder - b.joinOrder);
}

/** How many chips at least `min` px wide, `gap` apart, fit in a row `width` px wide (always at least one). */
export function chipCapacity(width: number, min: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** The row never scrolls: every chip when they all fit, otherwise one slot gives way to a "+K" chip. */
export function chipLayout(count: number, capacity: number): { shown: number; more: number } {
  if (count <= capacity) return { shown: count, more: 0 };
  const shown = Math.max(0, capacity - 1);
  return { shown, more: count - shown };
}

/**
 * The players row in a row `width` px wide: every player named while all of them fit with their
 * names; otherwise faces, as many as fit, the last slot a "+K" when not even every face does. A face
 * takes less room than a name, so a wider row never shows fewer players, and with a "+K" less room
 * is left over than one more face would take (the chips share it). `faces` asks for faces whatever
 * the width (a short screen, with no height for the names).
 */
export function chipFit(width: number, count: number, sizes: ChipSizes = CHIP_SIZES, faces = false): { faces: boolean; shown: number; more: number } {
  if (!faces && count <= chipCapacity(width, sizes.min, sizes.gap)) return { faces: false, shown: count, more: 0 };
  return { faces: true, ...chipLayout(count, chipCapacity(width, sizes.faceMin, sizes.faceGap)) };
}

/** A length custom property of `el` in px, or `fallback`. */
function cssPx(el: HTMLElement, name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Offline and sitting out are the platform's to say; otherwise the game's status, or "Ready". */
export function chipStatus(room: RoomState, player: PlayerPublic, game: AnyGameClientModule | null): PlayerStatus {
  if (!player.connected) return { label: 'Away', icon: <MoonIcon {...CHIP_ICON} />, tone: 'muted' };
  if (!player.participating) return { label: 'Watching', icon: <EyeIcon {...CHIP_ICON} />, tone: 'muted' };
  return game?.playerStatus?.(room, player) ?? { label: 'Ready', icon: <CheckIcon {...CHIP_ICON} strokeWidth={3} />, tone: 'ready' };
}

interface Props {
  room: RoomState;
  game: AnyGameClientModule | null;
  open: boolean;
  onOpen(): void;
  label: string;
}

interface RowRoom {
  width: number;
  sizes: ChipSizes;
  faces: boolean;
}

const sameRoom = (a: RowRoom, b: RowRoom) =>
  a.width === b.width && a.faces === b.faces && (Object.keys(a.sizes) as (keyof ChipSizes)[]).every((k) => a.sizes[k] === b.sizes[k]);

/**
 * The players under the game's name: avatar, name and a status badge per chip, or the faces alone
 * while the names do not all fit (chipFit). The whole row opens the players sheet; when more
 * players are in than fit, the last slot is a "+K" chip.
 */
export function PlayerChips({ room, game, open, onOpen, label }: Props) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [row, setRow] = useState<RowRoom>({ width: 4 * CHIP_SIZES.w + 3 * CHIP_SIZES.gap, sizes: CHIP_SIZES, faces: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The stylesheet sizes both looks and asks for faces on a short screen, so all of it is read from
    // there. The row fills what its line leaves whatever its chips, so the look never feeds back.
    const measure = () => {
      const next: RowRoom = {
        width: el.clientWidth,
        sizes: {
          w: cssPx(el, '--chip-w', CHIP_SIZES.w),
          min: cssPx(el, '--chip-min', CHIP_SIZES.min),
          gap: cssPx(el, '--chip-gap', CHIP_SIZES.gap),
          faceW: cssPx(el, '--chip-face-w', CHIP_SIZES.faceW),
          faceMin: cssPx(el, '--chip-face-min', CHIP_SIZES.faceMin),
          faceGap: cssPx(el, '--chip-face-gap', CHIP_SIZES.faceGap),
        },
        faces: getComputedStyle(el).getPropertyValue('--chip-look').trim() === 'faces',
      };
      setRow((prev) => (sameRoom(prev, next) ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const players = chipOrder(room.players);
  const { faces, shown, more } = chipFit(row.width, players.length, row.sizes, row.faces);

  return (
    <button
      ref={ref}
      type="button"
      className={`chips${faces ? ' chips--faces' : ''}`}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${label} (${players.length})`}
      data-testid="players-toggle"
      data-look={faces ? 'faces' : 'named'}
    >
      {players.slice(0, shown).map((p) => {
        const status = chipStatus(room, p, game);
        return (
          <span key={p.id} className={`chip${p.connected ? '' : ' chip--away'}`} data-testid="player-chip" data-player={p.id} data-status={status.tone} data-label={status.label}>
            <Avatar avatar={p.avatar} size="md" />
            <span className="chip__name">{p.name}</span>
            <span className={`chip__status chip__status--${status.tone}`}>
              <span className="chip__icon">{status.icon}</span>
              {status.label}
            </span>
          </span>
        );
      })}
      {more > 0 && (
        <span className="chip chip--more" data-testid="chips-more">
          +{more}
        </span>
      )}
    </button>
  );
}
