import { Children, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { ChipIcon } from '../components/Chips';
import { CheckIcon, CloseIcon, SparkIcon } from '../components/Icons';
import { CardsIcon, OutIcon, StarIcon } from './Icons';
import { TotalPill, type Tone } from './Outcome';
import { StackCount } from './Stakes';
import type { StakeFormat } from './stakes';
import { ARC_LIFT, GRID_GAP, arcLift, fitGrid, fitsRoom, naturalHeight, shapeOf, tierFor, tileHeight, type Room, type TileTier } from './grid';
import { roomLeft } from './room';

interface GridProps {
  /** How many tiles there are (the columns go by it, and the tier by the room they have). */
  count: number;
  label: string;
  /** Desktop: wider tiles, set along a gentle arc. */
  wide?: boolean;
  /** No seat has cards yet (before the deal): a full tile keeps to its top rows. */
  bare?: boolean;
  /** The tiles, drawn for the tier the grid settled on. */
  children: (tier: TileTier) => ReactNode;
}

interface Measured {
  /** The grid's own box, inside its padding. */
  box: { width: number; height: number };
  room: Room;
}

/**
 * The grid's own size, and the room the table leaves it (room.ts roomLeft: its parent's height
 * less the rows beside it and the gaps between them, as the table reads it to size a phone's
 * cards). The grid itself is capped to what the tiles need, so the room, not the box, says which
 * tier fits.
 */
function measure(el: HTMLElement): Measured {
  const style = getComputedStyle(el);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const box = { width: el.clientWidth, height: el.clientHeight - padY };
  const parent = el.parentElement;
  if (!parent) return { box, room: { width: box.width, height: box.height } };
  return { box, room: { width: box.width, height: roomLeft(parent, el) } };
}

const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }): boolean => a.width === b.width && a.height === b.height;

/** The grid's size and room, read as it lays out and again whenever it or a row beside it changes. */
function useMeasured(): [RefObject<HTMLUListElement | null>, Measured | null] {
  const ref = useRef<HTMLUListElement | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = measure(el);
      setMeasured((m) => (m && sameSize(m.box, next.box) && sameSize(m.room, next.room) ? m : next));
    };
    read();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    observer?.observe(el);
    for (const sibling of Array.from(el.parentElement?.children ?? [])) if (sibling !== el) observer?.observe(sibling);
    return () => observer?.disconnect();
  }, []);
  return [ref, measured];
}

/**
 * Every other seated player as a tile, in seat order (left to right, top to bottom, the order of
 * play). The grid never scrolls: it takes the space it is given, and the tiles step down in size
 * and detail as the table grows and the room shrinks (grid.ts). On a desktop the rows bow into a
 * gentle arc.
 */
export function PlayersGrid({ count, label, wide = false, bare = false, children }: GridProps) {
  const [ref, measured] = useMeasured();
  // The tier on show stays while it fits (tierFor): remembered across renders, never flipped by a pixel.
  const shown = useRef<TileTier | null>(null);
  const tier = tierFor(count, measured?.room ?? null, { wide, current: shown.current });
  useLayoutEffect(() => {
    shown.current = tier;
  });
  const shape = shapeOf(tier, wide);
  const { cols, rows } = fitGrid(count, measured?.box ?? null, { wide, tier });
  // The height the grid asks for: what its tiles need at their natural size in this width, within the room where the tier fits it.
  const wanted = measured ? naturalHeight(count, measured.box.width, { wide, tier, bare }) : 0;
  const natural = measured ? `${fitsRoom(count, measured.room, { wide, tier }) ? Math.min(wanted, measured.room.height) : wanted}px` : undefined;
  const style = { '--cols': cols, '--rows': rows, '--tile-w': `${shape.width}px`, '--tile-h': `${tileHeight(tier, wide, bare)}px`, '--grid-gap': `${GRID_GAP[tier]}px`, '--arc': `${ARC_LIFT[tier]}px`, '--grid-natural': natural } as CSSProperties;
  return (
    <ul ref={ref} className={`tbl-grid tbl-grid--${tier}${wide ? ' tbl-grid--arc' : ''}`} style={style} aria-label={label} data-testid="seats" data-tier={tier} data-cols={cols} data-count={count}>
      {Children.toArray(children(tier)).map((child, i) => (
        <li key={isValidElement(child) && child.key !== null ? child.key : i} className="tbl-grid__cell" style={wide ? arcCell(i, cols, count) : undefined}>
          {child}
        </li>
      ))}
    </ul>
  );
}

/**
 * A desktop tile's place on the arc: its lift, and on a short last row the half-column it starts
 * at, so that row sits centred under the others (the arc grid has two tracks a column).
 */
function arcCell(i: number, cols: number, count: number): CSSProperties {
  const row = Math.floor(i / cols);
  const inRow = Math.min(cols, count - row * cols);
  const col = i % cols;
  const style: Record<string, string | number> = { '--lift': arcLift(col, inRow) };
  if (col === 0 && inRow < cols) style.gridColumnStart = cols - inRow + 1;
  return style as CSSProperties;
}

/** How a seat's status line reads: the turn in the accent, a settled result strong, out in red, the rest quiet. */
export type SeatLineTone = 'turn' | 'strong' | 'bad' | 'quiet';

export interface SeatLine {
  /** The game's own state name, for data-state. */
  state: string;
  text: string;
  tone: SeatLineTone;
}

/**
 * The seat's status at a glance, as the icon in a compact tile and the dot on a small one: on
 * turn, still to act, done, a bet down, an outcome, out of chips, sitting out, folded, all in.
 */
export type SeatMark = 'turn' | 'waiting' | 'done' | 'bet' | 'win' | 'blackjack' | 'loss' | 'push' | 'out' | 'idle' | 'folded' | 'allin';

function MarkIcon({ mark }: { mark: SeatMark }) {
  const p = { size: 10, strokeWidth: 2.8 };
  switch (mark) {
    case 'turn':
      return <CardsIcon {...p} />;
    case 'done':
    case 'win':
      return <CheckIcon {...p} strokeWidth={3.2} />;
    case 'bet':
      return <ChipIcon {...p} />;
    case 'blackjack':
      return <StarIcon {...p} />;
    case 'loss':
    case 'folded':
      return <CloseIcon {...p} />;
    case 'out':
      return <OutIcon {...p} />;
    case 'allin':
      return <SparkIcon {...p} />;
    default:
      return null;
  }
}

/** How a seat's last hand went, once settled: the tile takes the outcome's colour. */
export type SeatOutcome = 'win' | 'blackjack' | 'loss' | 'push';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface TileProps {
  playerId: string;
  name: string;
  avatar: AvatarData;
  connected: boolean;
  /** The tier the grid settled on (PlayersGrid hands it to its children). */
  tier: TileTier;
  /** Whose turn it is: a thick lime ring and the Playing tag. */
  turn: boolean;
  /** On turn but not playing it (the phone went quiet): this word in a plain tag instead of Playing. */
  turnNote?: string;
  line: SeatLine;
  mark: SeatMark;
  /** The settled outcome, kept on show until the next deal. */
  outcome?: SeatOutcome | null;
  /** The stack, in words ("1,000 chips"; "1.2k chips" where a tile is too small for the full figure; the figure alone beside the total on a compact tile under 100px). */
  chips?: number;
  /** The stake in front of the seat, as its own pill of chips (StakePill, with tileChips for the tier). */
  bet?: ReactNode;
  /** The total, shown wherever the cards are not; `short` stands in for it where it shares the stack's line (table.css: Blackjack's two split hands, "21/15", read as the hand in play, "15"). */
  total?: { text: string; tone: Tone; short?: string } | null;
  /** Folded, out, not dealt in: dimmed. */
  dimmed?: boolean;
  /** After the name (the dealer button). */
  badge?: ReactNode;
  /** A word in the corner ("All in"). */
  tag?: string | null;
  /** The cards in miniature, on full tiles. */
  cards?: ReactNode;
  /** Laid over the tile (a payout rising). */
  extra?: ReactNode;
  /** Opens the seat's sheet with its full hand. */
  onOpen?(): void;
  /** The total only stands in for the stack (Poker's): shown only where the tile is too short for the stack in words. */
  shortBadge?: boolean;
  data?: DataAttrs;
}

/**
 * How a tile writes its figures: `fit` (both forms, table.css picks one) on a full or a compact
 * tile, short on the small tiers. A stack reads in full, so "1,040 chips" never reads like "1,000
 * chips", but for a five-digit one on a compact tile ("12k chips") and anything under 80px wide. A
 * stake reads short ("1k") on a compact tile, whose lines are short, when its pill has two chips
 * or a plus, and when it has four digits under 200px wide (every compact tile but the widest):
 * there its chips tell 1,040 (an ink chip, an off-white one and a plus) from 1,000 (one ink chip).
 * A full tile reads a four-digit stake short under 140px wide (three across a phone) and, 200px to
 * 239px wide, in a pill of two chips or a plus; elsewhere in full.
 */
export function tileFigures(tier: TileTier): StakeFormat {
  return tier === 'full' || tier === 'compact' ? 'fit' : 'short';
}

/** How many chips a tile's bet pill draws at most: three on a full tile, two on the smaller tiers, whose lines are short. */
export function tileChips(tier: TileTier): number {
  return tier === 'full' ? 3 : 2;
}

/** One player in the grid; how much it shows depends on the tier (table.css lays each tier out). */
export function PlayerTile({ playerId, name, avatar, connected, tier, turn, turnNote, line, mark, outcome = null, chips, bet, total, dimmed = false, badge, tag, cards, extra, onOpen, shortBadge = false, data }: TileProps) {
  return (
    <div
      className={`tbl-tile tbl-tile--${tier}${turn ? ' tbl-tile--turn' : ''}${dimmed ? ' tbl-tile--dim' : ''}${outcome ? ` tbl-tile--${outcome}` : ''}${shortBadge ? ' tbl-tile--short-badge' : ''}`}
      data-testid="seat"
      data-player-id={playerId}
      data-name={name}
      data-state={line.state}
      data-mark={mark}
      data-result={outcome ?? undefined}
      data-turn={turn}
      aria-current={turn ? 'true' : undefined}
      {...data}
    >
      <span className="tbl-tile__face" data-table-anchor={`seat:${playerId}`}>
        <Avatar avatar={avatar} size="sm" dimmed={!connected} />
        <span className={`tbl-tile__mark tbl-tile__mark--${mark}`} aria-hidden="true">
          <MarkIcon mark={mark} />
        </span>
      </span>
      <span className="tbl-tile__name">
        <span className="tbl-tile__name-text">{name}</span>
        {badge}
      </span>
      <span className="tbl-tile__meta">
        {chips !== undefined && <StackCount value={chips} format={tileFigures(tier)} className="tbl-tile__chips" testId="seat-chips" />}
        {bet !== undefined && <span className="tbl-tile__bet">{bet}</span>}
        <span className={`tbl-tile__line tbl-tile__line--${line.tone}`} data-testid="seat-line">
          {line.text}
        </span>
      </span>
      {total && (
        <span className="tbl-tile__total">
          <TotalPill tone={total.tone} testId="seat-total" short={total.short}>
            {total.text}
          </TotalPill>
        </span>
      )}
      {tier === 'full' && cards && <span className="tbl-tile__cards">{cards}</span>}
      {turn ? (
        <span className={`tbl-tile__tag${turnNote ? '' : ' tbl-tile__tag--turn'}`} data-testid="seat-playing">
          {turnNote ?? 'Playing'}
        </span>
      ) : (
        tag && <span className="tbl-tile__tag">{tag}</span>
      )}
      {extra}
      {onOpen && (
        <button type="button" className="tbl-tile__open" onClick={onOpen} aria-label={`${name}: ${line.text || 'seat'}. Show details`} data-testid="seat-open" />
      )}
    </div>
  );
}

/** A seat's full detail, opened by tapping its tile: the game draws what goes in it. */
export function SeatSheet({ title, onClose, children }: { title: string | null; onClose(): void; children: ReactNode }) {
  return (
    <BottomSheet open={title !== null} title={title ?? ''} onClose={onClose} testId="seat-sheet">
      <div className="tbl-seat-sheet">{children}</div>
    </BottomSheet>
  );
}
