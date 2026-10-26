import { Children, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { ChipIcon } from '../components/Chips';
import { CheckIcon, ChevronIcon, CloseIcon, SparkIcon } from '../components/Icons';
import { useScrollFade } from '../lib/useScrollFade';
import { CardsIcon, OutIcon, StarIcon } from './Icons';
import { TotalPill, type Tone } from './Outcome';
import { FitText, TILE_FIT } from './fit';
import { ChipMark, STACK_CHIP, StackCount, StakePill } from './Stakes';
import type { StakeFormat } from './stakes';
import { CARD_FLOOR, GRID_GAP, columnWidth, fanStep, fitGrid, fitStrip, fitsRoom, naturalHeight, seatPlan, shapeOf, stripHeight, stripRows, tileHeight, type Room, type SeatPlan, type TileTier } from './grid';
import { betChips, chipFigure } from './stakes';
import { shortChips } from '../lib/format';
import { roomLeft, seatsWidth } from './room';

interface GridProps {
  /** How many tiles there are (the columns go by it, and the tier by the room they have). */
  count: number;
  label: string;
  /** Desktop: wider tiles, a short last row centred under the others. */
  wide?: boolean;
  /** No seat has cards yet (before the deal): a full tile keeps to its top rows. */
  bare?: boolean;
  /** The tiles, drawn for the tier the grid settled on. */
  children: (tier: TileTier) => ReactNode;
}

interface Measured {
  /** The grid's own box, inside its padding (a strip's, out over the felt's padding). */
  box: { width: number; height: number };
  room: Room;
}

/**
 * The grid's own size, and the room the table leaves it (room.ts roomLeft: its parent's height
 * less the rows beside it and the gaps between them, as the table reads it to size a phone's
 * cards; its width, the row's, a strip's run over the felt's padding left out). The grid itself
 * is capped to what the tiles need, so the room, not the box, says which tier fits.
 */
function measure(el: HTMLElement): Measured {
  const style = getComputedStyle(el);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const box = { width: el.clientWidth, height: el.clientHeight - padY };
  const width = seatsWidth(el);
  const parent = el.parentElement;
  if (!parent) return { box, room: { width, height: box.height } };
  return { box, room: { width, height: roomLeft(parent, el) } };
}

const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }): boolean => a.width === b.width && a.height === b.height;

/**
 * The grid's size and room, read as it lays out and again whenever it or a row beside it changes,
 * and when the seats change between a grid and a strip (a new box to read: the ref is a setter).
 */
function useMeasured(): [(el: HTMLElement | null) => void, Measured | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  useLayoutEffect(() => {
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
  }, [el]);
  return [setEl, measured];
}

/** Whether the grid is a desktop's: a tile's cards keep that floor (grid.ts CARD_FLOOR). */
const TileRoom = createContext<{ wide: boolean }>({ wide: false });

/**
 * Every other seated player as a tile, in seat order (left to right, top to bottom, the order of
 * play). The grid never scrolls: it takes the space it is given, and the tiles step down in size
 * as the table grows and the room shrinks (grid.ts). Past what the room holds with every tile
 * whole, the seats are a strip of full tiles that scrolls sideways (SeatStrip), and the rest of
 * the table stays put. A desktop row is flat.
 */
export function PlayersGrid({ count, label, wide = false, bare = false, children }: GridProps) {
  const [ref, measured] = useMeasured();
  // The plan on show, and a strip's rows, stay while they fit (seatPlan, stripRows): remembered across renders, never flipped by a pixel.
  const shown = useRef<SeatPlan | null>(null);
  const shownRows = useRef<number | null>(null);
  const plan = seatPlan(count, measured?.room ?? null, { wide, current: shown.current });
  const stripped = plan.strip && measured ? stripRows(count, measured.room.height, wide, shownRows.current) : null;
  useLayoutEffect(() => {
    shown.current = plan;
    shownRows.current = stripped;
  });
  const tier = plan.tier;
  if (measured && stripped !== null) {
    return (
      <TileRoom.Provider value={{ wide }}>
        <SeatStrip outer={ref} count={count} label={label} wide={wide} bare={bare} rows={stripped} measured={measured}>
          {children(tier)}
        </SeatStrip>
      </TileRoom.Provider>
    );
  }
  const shape = shapeOf(tier, wide);
  const { cols, rows } = fitGrid(count, measured?.box ?? null, { wide, tier });
  // The height the grid asks for: what its tiles need at their natural size in this width, within the room where the tier fits it.
  const wanted = measured ? naturalHeight(count, measured.box.width, { wide, tier, bare }) : 0;
  const natural = measured ? `${fitsRoom(count, measured.room, { wide, tier }) ? Math.min(wanted, measured.room.height) : wanted}px` : undefined;
  const colWidth = measured ? columnWidth(measured.box.width, cols, GRID_GAP[tier]) : null;
  const style = { '--cols': cols, '--rows': rows, '--tile-w': `${shape.width}px`, '--tile-h': `${tileHeight(tier, wide, bare, colWidth)}px`, '--grid-gap': `${GRID_GAP[tier]}px`, '--grid-natural': natural } as CSSProperties;
  return (
    <TileRoom.Provider value={{ wide }}>
    <ul ref={ref} className={`tbl-grid tbl-grid--${tier}${wide ? ' tbl-grid--arc' : ''}`} style={style} aria-label={label} data-testid="seats" data-tier={tier} data-cols={cols} data-count={count}>
      {Children.toArray(children(tier)).map((child, i) => (
        <li key={isValidElement(child) && child.key !== null ? child.key : i} className="tbl-grid__cell" style={wide ? arcCell(i, cols, count) : undefined}>
          {child}
        </li>
      ))}
    </ul>
    </TileRoom.Provider>
  );
}

/** How long the strip waits after a player last moved it before it brings the seat on turn into view, in ms. */
export const STRIP_HOLD_MS = 4000;

/** How far a mouse wheel turns (in px of its delta) to move the strip one column sideways. */
const WHEEL_STEP = 30;

/** The seat on turn in the strip (its tile carries aria-current), and the cell it sits in. */
function turnCell(strip: HTMLElement): { id: string; cell: HTMLElement } | null {
  const tile = strip.querySelector<HTMLElement>('[data-testid="seat"][aria-current="true"]');
  const cell = tile?.closest<HTMLElement>('.tbl-grid__cell');
  return tile && cell ? { id: tile.dataset.playerId ?? '', cell } : null;
}

/** Scrolls `strip` so `cell` sits whole between its ends (`edge` px each, under the fades), snapped to the left end; nothing where it already does. */
function bringIntoView(strip: HTMLElement, cell: HTMLElement, edge: number, smooth: boolean): void {
  const box = strip.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  if (r.left >= box.left + edge - 1 && r.right <= box.right - edge + 1) return;
  const left = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + r.left - box.left - edge));
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  strip.scrollTo({ left, behavior: smooth && !still ? 'smooth' : 'auto' });
}

/**
 * The strip's moves: the seat on turn brought into view when the turn moves to it (at once when
 * the strip first shows), never while a player is moving the strip themselves (a swipe, the
 * wheel, a key, the hint) or for STRIP_HOLD_MS after; brought back at once when the strip is laid
 * out afresh (`layout`: its rows, columns or tile width, a phone turned), unless a player has just
 * moved it; and a mouse wheel turned up or down moves it sideways a column at a time (a trackpad's
 * sideways swipe scrolls it as it is). Returns the hook to call when the player moves it some
 * other way.
 */
function useStripMoves(ref: RefObject<HTMLElement | null>, edge: number, step: number, layout: string): () => void {
  const touched = useRef(Number.NEGATIVE_INFINITY);
  const shownTurn = useRef<string | null | undefined>(undefined);
  const shownLayout = useRef(layout);
  const timer = useRef<number | undefined>(undefined);
  const ends = useRef({ edge, step });
  useLayoutEffect(() => {
    ends.current = { edge, step };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mark = () => {
      touched.current = performance.now();
    };
    let pending = 0;
    let quiet = 0;
    const wheel = (e: WheelEvent) => {
      mark();
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth + 1) return;
      e.preventDefault();
      pending += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      const now = performance.now();
      if (now < quiet || Math.abs(pending) < WHEEL_STEP) return;
      el.scrollBy({ left: Math.sign(pending) * ends.current.step, behavior: 'smooth' });
      pending = 0;
      quiet = now + 200;
    };
    const moves = ['pointerdown', 'touchstart', 'touchmove', 'keydown'] as const;
    for (const type of moves) el.addEventListener(type, mark, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      for (const type of moves) el.removeEventListener(type, mark);
      el.removeEventListener('wheel', wheel);
      window.clearTimeout(timer.current);
    };
  }, [ref]);
  // After every render: has the turn moved to another seat, or the strip been laid out afresh?
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const turn = turnCell(el);
    const id = turn?.id ?? null;
    if (layout !== shownLayout.current) {
      shownLayout.current = layout;
      // The browser keeps the tile it had at the left end there, which may now leave the seat on turn out of view.
      if (turn && id === shownTurn.current && performance.now() - touched.current >= STRIP_HOLD_MS) bringIntoView(el, turn.cell, ends.current.edge, false);
    }
    if (id === shownTurn.current) return;
    const first = shownTurn.current === undefined;
    shownTurn.current = id;
    window.clearTimeout(timer.current);
    if (id === null) return;
    const bring = () => {
      const since = performance.now() - touched.current;
      if (since < STRIP_HOLD_MS) {
        timer.current = window.setTimeout(bring, STRIP_HOLD_MS - since + 50);
        return;
      }
      // The turn may have moved on while the strip waited: the seat on turn now.
      const now = turnCell(el);
      if (now) bringIntoView(el, now.cell, ends.current.edge, !first);
    };
    bring();
  });
  return () => {
    touched.current = performance.now();
  };
}

interface StripProps {
  outer(el: HTMLElement | null): void;
  count: number;
  label: string;
  wide: boolean;
  bare: boolean;
  rows: number;
  measured: Measured;
  children: ReactNode;
}

/**
 * A big table's seats: full tiles (every seat's cards, bet and stack) in a strip that scrolls
 * sideways, in seat order down each column and on to the next, as many rows as the room holds.
 * Only the strip scrolls (a swipe, a trackpad, the wheel), snapping a tile to its left end; it runs
 * out over the felt's padding, and where more seats wait past an end, the next one peeks out under
 * a fade with a small hint over it (a tap on it moves the strip on a page). The seat on turn comes
 * into view as the turn moves (useStripMoves). A tap on a tile opens its sheet; a swipe never does.
 */
function SeatStrip({ outer, count, label, wide, bare, rows, measured, children }: StripProps) {
  const fit = fitStrip(count, measured.box.width, rows, wide);
  const gap = GRID_GAP.full;
  const strip = useRef<HTMLUListElement | null>(null);
  const [fade] = useScrollFade(strip, true, 'x');
  const moved = useStripMoves(strip, fit.edge, fit.tile + gap, `${rows}:${fit.view}:${fit.tile}`);
  // Where a press began: a click after the strip or the pointer has moved since is the end of a swipe, not a tap.
  const press = useRef<{ x: number; y: number; left: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLUListElement>) => {
    press.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft };
  };
  const onClickCapture = (e: ReactMouseEvent<HTMLUListElement>) => {
    const p = press.current;
    press.current = null;
    // A key's click (detail 0) is never a swipe.
    if (!p || e.detail === 0) return;
    if (Math.abs(e.currentTarget.scrollLeft - p.left) > 2 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const page = (dir: 1 | -1) => {
    moved();
    strip.current?.scrollBy({ left: dir * fit.view * (fit.tile + gap), behavior: 'smooth' });
  };
  const style = {
    '--rows': rows,
    '--tile-h': `${tileHeight('full', wide, bare)}px`,
    '--grid-gap': `${gap}px`,
    '--grid-natural': `${Math.min(stripHeight(rows, wide, bare), measured.room.height)}px`,
    '--strip-w': `${fit.tile}px`,
    '--strip-edge': `${fit.edge}px`,
  } as CSSProperties;
  return (
    <div ref={outer} className={`tbl-grid tbl-grid--full tbl-grid--strip${wide ? ' tbl-grid--arc' : ''}`} style={style} data-testid="seats" data-tier="full" data-strip="" data-cols={fit.cols} data-rows={rows} data-view={fit.view} data-count={count}>
      <ul ref={strip} className="tbl-strip scroll-fade scroll-fade--x" aria-label={label} data-testid="seat-strip" data-fade={fade} onPointerDown={onPointerDown} onPointerCancel={() => (press.current = null)} onClickCapture={onClickCapture}>
        {Children.toArray(children).map((child, i) => (
          <li key={isValidElement(child) && child.key !== null ? child.key : i} className="tbl-grid__cell">
            {child}
          </li>
        ))}
      </ul>
      {fade?.includes('left') && (
        <button type="button" className="tbl-strip__more tbl-strip__more--left" onClick={() => page(-1)} aria-label="Earlier players" data-testid="seat-strip-more" data-side="left">
          <ChevronIcon size={14} strokeWidth={2.6} />
        </button>
      )}
      {fade?.includes('right') && (
        <button type="button" className="tbl-strip__more tbl-strip__more--right" onClick={() => page(1)} aria-label="More players" data-testid="seat-strip-more" data-side="right">
          <ChevronIcon size={14} strokeWidth={2.6} />
        </button>
      )}
    </div>
  );
}

/** A desktop tile on a short last row: the half-column it starts at, so that row sits centred under the others (the grid has two tracks a column). */
function arcCell(i: number, cols: number, count: number): CSSProperties | undefined {
  const row = Math.floor(i / cols);
  const inRow = Math.min(cols, count - row * cols);
  return i % cols === 0 && inRow < cols ? { gridColumnStart: cols - inRow + 1 } : undefined;
}

/** A figure on a tile: whole under 10,000 ("1,040"), short above ("50k", "1.3M"). */
export function tileFigure(n: number): string {
  return n < 10_000 ? chipFigure(n, 'full') : shortChips(n);
}

/** A tile's figure, then its short form where that differs ("1,250", then "1.3k"), for a line with no room for the whole one. */
export function figureForms(n: number): string[] {
  const whole = tileFigure(n);
  const short = shortChips(n);
  return short === whole ? [whole] : [whole, short];
}

/** How a seat's status line reads: the turn in the accent, a settled result strong, out in red, the rest quiet. */
export type SeatLineTone = 'turn' | 'strong' | 'bad' | 'quiet';

export interface SeatLine {
  /** The game's own state name, for data-state. */
  state: string;
  text: string;
  tone: SeatLineTone;
  /**
   * Shorter forms of the text, each shorter than the one before, for a tile too narrow for it
   * whole: Poker's "Raise to 12,000" reads "Raise 12k", then "Raise" (the bet pill beside it says
   * the figure). The tile shows the first form that fits (fit.tsx), never a cut one.
   */
  short?: readonly string[];
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
  /** Whose turn it is: a thick lime ring. */
  turn: boolean;
  /** On turn but not playing it (the phone went quiet): this word in a plain tag instead of Playing. */
  turnNote?: string;
  line: SeatLine;
  mark: SeatMark;
  /** The settled outcome, kept on show until the next deal. */
  outcome?: SeatOutcome | null;
  /** The stack: its figure by a lime chip ("1,040", "1.3M": tileFigure); the crowd's tiers write it in words where they have the room. */
  chips?: number;
  /** The stake in front of the seat: "bet 50k" on a tile's footer, a pill of chips on the crowd tiers. Unset: no bet line. */
  bet?: number;
  /** The starting stack, for the chips of a crowd tier's stake pill. */
  start?: number;
  /** On the bet's box (Poker's anchor for the chips flying to it). */
  betData?: DataAttrs;
  /** The hand's total, big beside the cards (Blackjack: two split hands joined, "21/15"). */
  total?: { text: string; tone: Tone; short?: string } | null;
  /** Folded, out, not dealt in: dimmed. */
  dimmed?: boolean;
  /** After the name (the dealer button). */
  badge?: ReactNode;
  /** A word in the corner ("All in"). */
  tag?: string | null;
  /** The cards in miniature. */
  cards?: ReactNode;
  /** How many cards the seat holds in this tile (data-cards, for the tests): 0 before the deal, or where its hands are on my stage. */
  held?: number;
  /** Folded (Poker): two empty places where the cards were, the pill saying so. */
  folded?: boolean;
  /**
   * How the cards lie, for their size (table.css) and their step (a long hand overlaps more): the
   * most cards in any one hand and how many hands there are (split hands side by side where they
   * fit at the floor). Unset: one hand of two (Poker's hole cards).
   */
  fan?: { cards: number; hands: number };
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
export function PlayerTile(props: TileProps) {
  return props.tier === 'full' || props.tier === 'compact' ? <SeatTile {...props} /> : <CrowdTile {...props} />;
}

/**
 * The fan's step for `cards` cards in a box `width` px wide at the card floor (grid.ts fanStep),
 * measured as the tile lays out, so a long hand overlaps more rather than run off the tile.
 */
function useFanStep(ref: RefObject<HTMLElement | null>, cards: number, floor: number): number | null {
  const [step, setStep] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = fanStep(el.clientWidth, cards, floor);
      setStep((prev) => (prev === next ? prev : next));
    };
    read();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref, cards, floor]);
  return step;
}

/** The characters of a name a tile always shows: all of a shorter one; a longer one is cut (an ellipsis) only past them. */
export const NAME_FLOOR = 6;

/**
 * Holds a tile's name at least as wide as its first NAME_FLOOR characters (and the ellipsis after
 * them where it is longer), measured in its own font as it lays out and again when that changes
 * (the fonts arriving, a bigger text size): the status pill beside it gives way first.
 */
function useNameFloor(ref: RefObject<HTMLSpanElement | null>, name: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const text = el.firstChild;
      if (!(text instanceof Text) || text.data.length === 0) return;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(text.data.length, NAME_FLOOR));
      let width = range.getBoundingClientRect().width;
      if (text.data.length > NAME_FLOOR) {
        const probe = document.createElement('span');
        probe.textContent = '\u2026';
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
        el.appendChild(probe);
        width += probe.getBoundingClientRect().width;
        probe.remove();
      }
      const next = `${Math.ceil(width) + 1}px`;
      if (el.style.minWidth !== next) el.style.minWidth = next;
    };
    read();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    observer?.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) read();
    });
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [ref, name]);
}

/**
 * A seat's tile (full or compact), everything a player looks for at once (table.css): a header
 * (avatar, name, the status pill with its mark); then the hand as a fan of readable cards, the big
 * total beside it (Blackjack), and the stack and the bet. A full tile puts the stack and the bet
 * in a column right of the cards; a compact one, narrower, on a line under them. The ring says
 * whose turn it is.
 */
function SeatTile({ playerId, name, avatar, connected, tier, turn, line, mark, outcome = null, chips, bet, start, betData, total, dimmed = false, badge, cards, held = 0, folded = false, fan, extra, onOpen, shortBadge = false, data }: TileProps) {
  const room = useContext(TileRoom);
  const cardsRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  useNameFloor(nameRef, name);
  const fanCards = Math.max(2, fan?.cards ?? 2);
  const step = useFanStep(cardsRef, fanCards, room.wide ? CARD_FLOOR.wide : CARD_FLOOR.phone);
  const fanStyle = { '--tile-fan': fanCards, '--tile-hands': Math.max(1, fan?.hands ?? 1), ...(step === null ? {} : { '--fan-step': step }) } as CSSProperties;
  // Poker's total only stood in for the stack, which the tile shows anyway: no total there.
  const hero = shortBadge ? null : total;
  const showCards = held > 0 && cards !== undefined;
  return (
    <div
      className={`tbl-tile tbl-tile--${tier}${turn ? ' tbl-tile--turn' : ''}${dimmed ? ' tbl-tile--dim' : ''}${outcome ? ` tbl-tile--${outcome}` : ''}`}
      data-testid="seat"
      data-player-id={playerId}
      data-name={name}
      data-state={line.state}
      data-mark={mark}
      data-result={outcome ?? undefined}
      data-turn={turn}
      data-cards={held}
      aria-current={turn ? 'true' : undefined}
      {...data}
    >
      <span className="tbl-tile__head">
        <span className="tbl-tile__face" data-table-anchor={`seat:${playerId}`}>
          <Avatar avatar={avatar} size="sm" dimmed={!connected} />
        </span>
        <span className="tbl-tile__name">
          <span ref={nameRef} className="tbl-tile__name-text">
            {name}
          </span>
          {badge}
        </span>
        {(line.text || mark === 'bet') && (
          <span className={`tbl-tile__pill tbl-tile__pill--${line.tone} tbl-tile__pill--${mark}`} data-testid="seat-pill">
            <span className="tbl-tile__pill-mark" aria-hidden="true">
              <MarkIcon mark={mark} />
            </span>
            {/* Its last form is none: a pill with no room for even the shortest word keeps its mark alone (table.css). */}
            {line.text && <FitText forms={[line.text, ...(line.short ?? []).filter(Boolean), '']} className={`tbl-tile__line tbl-tile__line--${line.tone}`} testId="seat-line" />}
          </span>
        )}
      </span>
      <span className="tbl-tile__body">
        {(showCards || folded) && (
          <span ref={cardsRef} className={`tbl-tile__cards${folded && !showCards ? ' tbl-tile__cards--folded' : ''}`} style={fanStyle} data-testid="seat-cards">
            {showCards ? (
              cards
            ) : (
              <>
                <span className="tbl-tile__slot" />
                <span className="tbl-tile__slot" />
              </>
            )}
          </span>
        )}
        {hero && (showCards || !folded) && (
          <span className="tbl-tile__total" data-testid="seat-total" data-tone={hero.tone} data-long={hero.text.length > 3 ? '' : undefined}>
            {/* Split hands' totals joined ("21/15"), or the hand in play's alone where the tile has no room for both. */}
            <FitText forms={hero.short ? [hero.text, hero.short] : [hero.text]} className="tbl-tile__total-text" />
          </span>
        )}
        {(chips !== undefined || bet !== undefined) && (
          <span className="tbl-tile__foot">
            {chips !== undefined && (
              <span className="tbl-tile__chips" data-testid="seat-chips" data-chips={chips}>
                <ChipMark bands={STACK_CHIP} />
                <FitText forms={figureForms(chips)} className="tbl-tile__chips-text" />
              </span>
            )}
            {bet !== undefined && (
              <span className="tbl-tile__bet" data-testid="seat-bet" data-bet={bet} {...betData}>
                {bet > 0 && <ChipMark bands={betChips(bet, start ?? bet, 2).bands} />}
                {/* "bet 50k"; where the tile has no room for the word, "50k" by its chips; for a long figure, its short form. */}
                {bet > 0 && <FitText forms={[`bet ${tileFigure(bet)}`, ...figureForms(bet)]} className="tbl-tile__bet-text" />}
              </span>
            )}
          </span>
        )}
      </span>
      {extra}
      {onOpen && <button type="button" className="tbl-tile__open" onClick={onOpen} aria-label={`${name}: ${line.text || 'seat'}. Show details`} data-testid="seat-open" />}
    </div>
  );
}

/** A crowd's tile (small, dense): the avatar with its status dot, the total, the name shortened. */
function CrowdTile({ playerId, name, avatar, connected, tier, turn, turnNote, line, mark, outcome = null, chips, bet, start = 0, betData, total, dimmed = false, badge, tag, extra, onOpen, shortBadge = false, data }: TileProps) {
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
        <span className="tbl-tile__money">
          {chips !== undefined && <StackCount value={chips} format={tileFigures(tier)} className="tbl-tile__chips" testId="seat-chips" fit={TILE_FIT} />}
          {bet !== undefined && (
            <span className="tbl-tile__bet" data-testid="seat-bet" data-bet={bet} {...betData}>
              {bet > 0 && <StakePill value={bet} start={start} chips={tileChips(tier)} format={tileFigures(tier)} />}
            </span>
          )}
        </span>
        <FitText forms={[line.text, ...(line.short ?? [])]} className={`tbl-tile__line tbl-tile__line--${line.tone}`} testId="seat-line" />
      </span>
      {total && (
        <span className="tbl-tile__total">
          <TotalPill tone={total.tone} testId="seat-total" short={total.short}>
            {total.text}
          </TotalPill>
        </span>
      )}
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
