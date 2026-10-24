import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { prefersReducedMotion } from '../../../platform/lib/media';
import { laidOutWidth, useScrollFade } from '../../../platform/lib/useScrollFade';
import { LEAST_GRID_CARD, SCROLL_CARD, planGrid, scrollToHand, type GridPlan, type HandPlace } from '../lib/hands';
import type { TableHand } from '../lib/table';
import type { Timeline } from '../lib/timeline';
import { Hand } from './Hand';

/**
 * The widest words on a hand in the row, as the room they need beside 3px of the hand's edge: over
 * its corner (its total, its stake or owner), or a split hand's chip under its cards (centred, so
 * it needs 1px a side less). They keep their width whatever the cards' size.
 */
function headWidth(el: HTMLElement): number {
  const widest = (sel: string) => Math.max(0, ...Array.from(el.querySelectorAll(sel)).map((h) => h.getBoundingClientRect().width));
  return Math.ceil(Math.max(widest('.tbl-hand__head'), widest('.bj-hand__foot') - 1));
}

/**
 * The row's width and the widest words over a hand's corner in it (its stake or owner and its
 * total, or how it ended), as it lays out (0 until measured, and on the server render): every slot
 * keeps room for those words. They never shrink while the row keeps its hands, so the slots never
 * flip back and forth.
 */
function useRowSize<T extends HTMLElement>(count: number, words = true, wordsKey = ''): [RefObject<T | null>, { width: number; height: number; head: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, head: 0 });
  // A new number of hands starts the words' width over.
  // So does a change in how the words are drawn (wordsKey: the stakes packed to their figures).
  const counted = useRef(`${count} ${wordsKey}`);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const fresh = counted.current !== `${count} ${wordsKey}`;
    counted.current = `${count} ${wordsKey}`;
    const width = el.clientWidth;
    const height = el.clientHeight;
    const said = words ? headWidth(el) : 0;
    setSize((s) => {
      const head = fresh ? said : Math.max(s.head, said);
      return s.width === width && s.height === height && s.head === head ? s : { width, height, head };
    });
  };
  // The observer is made again for a new number of hands, so its callback never measures with a stale count.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);
  // The words change with the hands, not the row's size: measured again after every render.
  useLayoutEffect(measure);
  return [ref, size];
}

/**
 * The most cards in any hand of the row and how many hands share it: the stylesheet sizes the
 * cards as a hand on its own gets them (blackjack.css --fit-w, however many hits), and gives each
 * hand an equal share of the row while they all fit.
 */
export function fanStyle(hands: readonly { cards: readonly unknown[] }[]): CSSProperties {
  const fan = Math.max(2, ...hands.map((h) => h.cards.length));
  return { '--hands': Math.max(1, hands.length), '--fan': fan } as CSSProperties;
}

/**
 * Brings the hand in play (`activeIndex`) to the middle of the row in `ref` as play moves on or a
 * split adds a hand: smoothly, or at once for a viewer who asked for less motion and when the row
 * itself changed (its first layout, its size, the words over its hands). With no hand in play
 * (the bets, the dealer's turn, the settled table) the row stays where the player left it. The row
 * is measured as laid out (`laidOutWidth`), so a dealt card still in the air never carries it past
 * its last hand.
 */
function useFollowHand(ref: RefObject<HTMLElement | null>, activeIndex: number, count: number, layout: string): void {
  const last = useRef<{ active: number; count: number } | null>(null);
  // Where the row was last sent for the hand in play (null with none in play).
  const target = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const before = last.current;
    last.current = { active: activeIndex, count };
    target.current = null;
    if (!el || activeIndex < 0) return;
    const slot = el.children[activeIndex];
    if (!(slot instanceof HTMLElement)) return;
    const left = scrollToHand({ left: slot.offsetLeft, width: slot.offsetWidth }, el.clientWidth, laidOutWidth(el));
    target.current = left;
    if (Math.abs(el.scrollLeft - left) < 1) return;
    const moved = before !== null && (before.active !== activeIndex || before.count !== count);
    el.scrollTo({ left, behavior: moved && !prefersReducedMotion() ? 'smooth' : 'auto' });
  }, [ref, activeIndex, count, layout]);
  // A hand that changes size after the row laid out (its cards sized to the room it was given, a
  // font arriving) moves where the hand in play sits: the row follows it again, at once. A glide
  // already on its way to the right place carries on.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => {
      if (target.current === null) return;
      const slot = el.children[last.current?.active ?? -1];
      if (!(slot instanceof HTMLElement)) return;
      const left = scrollToHand({ left: slot.offsetLeft, width: slot.offsetWidth }, el.clientWidth, laidOutWidth(el));
      if (Math.abs(left - target.current) < 1) return;
      target.current = left;
      el.scrollTo({ left, behavior: 'auto' });
    });
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, count]);
}

/** A length the row's stylesheet gives (a custom property's value), resolved to px where the row lays out. */
function resolve(el: HTMLElement, width: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:0;width:${width}`;
  el.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px;
}

/** The custom property on the felt by which my stage grows into the room the table leaves empty over it (table.css, room.ts). */
const STAGE_MORE = '--tbl-stage-more';

/** The room the felt's rows leave empty (shared out between them), in px: its inner height less every row and gap. */
function feltFree(felt: HTMLElement): number {
  const style = getComputedStyle(felt);
  const tracks = style.gridTemplateRows.split(' ').map(parseFloat).filter((n) => Number.isFinite(n));
  const inner = felt.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  return inner - tracks.reduce((a, b) => a + b, 0) - Math.max(0, tracks.length - 1) * (parseFloat(style.rowGap) || 0);
}

/** The most hands a grid holds (any realistic run of splits); past that one row that scrolls. */
const GRID_MOST = 8;

/** The air kept between my grown stage and the row over it, on top of the felt's row gap. */
const STAGE_AIR = 8;

/**
 * My split hands' grid (null: one hand, or a seat's row): planGrid over the row's width and the
 * height the stage has plus the room the table leaves empty over it. The stage grows up into that
 * room only as far as the grid needs (--tbl-stage-more on the felt), never into the dealer, the
 * banner or the seats, which keep their own heights. Applied in the same layout pass as a split,
 * so the row never shows a frame at the old size.
 */
function useGrid(ref: RefObject<HTMLElement | null>, on: boolean, fans: string, footed: boolean, width: number, height: number, head: number): GridPlan | null {
  const [plan, setPlan] = useState<GridPlan | null>(null);
  const felt = useRef<HTMLElement | null>(null);
  // The table's other rows change height on their own (a seat taken, the fonts arriving): plan again then.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const el = ref.current?.closest<HTMLElement>('.tbl-felt');
    if (!el || !on || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => setShift((n) => n + 1));
    for (const child of Array.from(el.children)) if (!child.contains(ref.current)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, on]);
  useLayoutEffect(() => {
    const el = ref.current;
    const counts = fans.split(',').map(Number);
    const table = el?.closest<HTMLElement>('.tbl-felt') ?? null;
    felt.current = table;
    let next: GridPlan | null = null;
    if (el && on && counts.length > 1 && el.clientWidth > 0) {
      const more = table ? parseFloat(table.style.getPropertyValue(STAGE_MORE)) || 0 : 0;
      const base = el.clientHeight - more;
      const room = table ? Math.max(0, feltFree(table) - STAGE_AIR) : 0;
      // The room the row has is its box's (the grid itself is only as wide as its columns).
      const across = el.parentElement?.clientWidth ?? el.clientWidth;
      next = planGrid({
        width: across,
        height: el.clientHeight + room,
        base,
        solo: resolve(el, 'var(--bj-solo-w)'),
        step: resolve(el, 'calc(1000px * var(--fan-step))') / 1000,
        handK: resolve(el, 'calc(1000px * var(--hand-k))') / 1000,
        pill: resolve(el, 'var(--tbl-pill-h)'),
        foot: footed ? resolve(el, 'var(--bj-foot-h)') : 0,
        fans: counts,
        least: Math.max(resolve(el, 'calc(var(--tbl-pill-h) * 1.3 + 6px)'), Math.max(head, headWidth(el)) + 3),
        gapX: parseFloat(getComputedStyle(el).columnGap) || 6,
        gapY: parseFloat(getComputedStyle(el).rowGap) || 6,
      });
      // Past eight hands, or where no grid shows a card worth reading: one row that scrolls, its ends fading.
      if (next.card < LEAST_GRID_CARD || counts.length > GRID_MOST) next = { cols: counts.length, rows: 1, card: SCROLL_CARD, cell: 0, height: base };
      const grow = next.rows > 1 ? Math.max(0, Math.ceil(next.height - base)) : 0;
      if (table && Math.abs(grow - more) >= 1) {
        if (grow > 0) table.style.setProperty(STAGE_MORE, `${grow}px`);
        else table.style.removeProperty(STAGE_MORE);
      }
    } else if (table && on) table.style.removeProperty(STAGE_MORE);
    // Set on the row at once too, so the hand in play is followed (useFollowHand, after this) in the row as it will show.
    if (el && on) {
      if (next === null || next.cell === 0) for (const name of ['--bj-fit', '--bj-cols', '--bj-cell']) el.style.removeProperty(name);
      if (next !== null && next.cell === 0) el.style.setProperty('--bj-fit', `${next.card}px`);
      else if (next !== null) {
        el.style.setProperty('--bj-fit', `${next.card}px`);
        el.style.setProperty('--bj-cols', String(next.cols));
        el.style.setProperty('--bj-cell', `${next.cell}px`);
      }
    }
    setPlan((p) => (p && next && p.cols === next.cols && p.rows === next.rows && p.card === next.card && p.cell === next.cell && p.height === next.height ? p : next));
  }, [ref, on, fans, footed, width, height, head, shift]);
  // My hands leave the stage: it goes back to its own height.
  useLayoutEffect(() => () => {
    felt.current?.style.removeProperty(STAGE_MORE);
  }, []);
  return plan;
}

interface Props {
  playerId: string;
  hands: TableHand[];
  /** The table's starting stack: the chips a stake is drawn in. */
  start: number;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  /** The hand in play, or -1. */
  activeIndex: number;
  /** `mine`: my hands on the stage at the bottom of the table; `stage`: another player's there, when I am not dealt in; `seat`: a seat's on its tile. */
  place: HandPlace;
  size: PlayingCardSize;
  /** A seat's hands in miniature (Hand's `mini`): each total by its own cards. */
  mini?: boolean;
  /** Each hand's stake by its total (my hands while they play). */
  stakes?: boolean;
  /** Another player's hands on my stage: their name by the hand in play's total (the first's, between turns). */
  ownerName?: string;
  testId: string;
}

/**
 * A seat's hands side by side, every one of them always its cards with its stake and total, the
 * cards the size a hand on its own gets here: a split never shrinks them. While they fit, each hand
 * has an equal share of the row; past that the row scrolls sideways inside its box (a hand to a
 * snap, by swipe, wheel or trackpad, no scrollbar), its cut ends fading (`.scroll-fade--x`) where
 * more hands wait, and it brings the hand in play to its middle as play moves on. The stage never
 * moves or resizes and the page never scrolls. Two or more hands mark the row `bj-hands--side`: on
 * a phone their stakes pack tighter (blackjack.css), and a hand on its own keeps its stake in full.
 * A seat's tile holds the same row in miniature (`mini`), its totals by its cards, so nothing is
 * said over a hand's corner and the row has no words to measure.
 */
export function HandRow({ playerId, hands, start, timeline, now, leaving, activeIndex, place, size, mini = false, stakes = false, ownerName, testId }: Props) {
  // Split hands on the stage (mine, or another player's) wrap into a grid (useGrid): styled so from their first frame, so their words are measured as the grid draws them.
  const [scrolls, setScrolls] = useState(false);
  const grid = place !== 'seat' && hands.length > 1 && !scrolls;
  const [ref, box] = useRowSize<HTMLDivElement>(hands.length, !mini);
  const [fade, refade] = useScrollFade(ref, true, 'x');
  // A new hand or a new size changes what the row holds, which the fade's own observer cannot see.
  useLayoutEffect(refade);
  const footed = place === 'mine' && hands.length > 1;
  const plan = useGrid(ref, place !== 'seat', hands.map((h) => Math.max(2, h.cards.length)).join(','), footed, box.width, box.height, box.head);
  // A plan with no cells is the scrolling row: the grid's styles go (kept so while the hands stay as many).
  const wantScroll = plan !== null && plan.cell === 0;
  useLayoutEffect(() => {
    if (wantScroll && !scrolls) setScrolls(true);
    if (!wantScroll && scrolls && plan === null) setScrolls(false);
  }, [wantScroll, scrolls, plan]);
  useFollowHand(ref, activeIndex, hands.length, `${box.width} ${box.head} ${plan?.card} ${plan?.cols}`);
  const cells: Record<string, string | number> = plan === null ? {} : plan.cell === 0 ? { '--bj-fit': `${plan.card}px` } : { '--bj-fit': `${plan.card}px`, '--bj-cols': plan.cols, '--bj-cell': `${plan.cell}px` };
  const style = { ...fanStyle(hands), '--bj-head-w': `${box.head}px`, ...cells } as unknown as CSSProperties;
  const named = activeIndex >= 0 ? activeIndex : 0;
  const side = hands.length > 1;
  return (
    <div ref={ref} className={`bj-hands bj-hands--${place} scroll-fade scroll-fade--x${side ? ' bj-hands--side' : ''}${grid ? ' bj-hands--grid' : ''}`} style={style} data-testid={`${testId}s-row`} data-count={hands.length} data-cols={plan?.cols} data-rows={plan?.rows} data-fade={fade}>
      {hands.map((hand, i) => (
        // Each slot keeps the room its own hand's words reach left of its own fan (blackjack.css --bj-head-room).
        <div key={i} className="bj-slot" style={{ '--slot-fan': Math.max(2, hand.cards.length) } as CSSProperties}>
          <Hand playerId={playerId} index={i} hand={hand} start={start} timeline={timeline} now={now} leaving={leaving} size={size} active={i === activeIndex} mini={mini} narrow={side} footed={footed} stake={stakes} ownerName={i === named ? ownerName : undefined} testId={testId} />
        </div>
      ))}
    </div>
  );
}
