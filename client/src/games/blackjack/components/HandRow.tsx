import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { prefersReducedMotion } from '../../../platform/lib/media';
import { laidOutWidth, useScrollFade } from '../../../platform/lib/useScrollFade';
import { scrollToHand, type HandPlace } from '../lib/hands';
import type { TableHand } from '../lib/table';
import type { Timeline } from '../lib/timeline';
import { Hand } from './Hand';

/** The widest head (the words over a hand's corner) in the row: they keep their width whatever the cards' size. */
function headWidth(el: HTMLElement): number {
  return Math.ceil(Math.max(0, ...Array.from(el.querySelectorAll('.tbl-hand__head')).map((h) => h.getBoundingClientRect().width)));
}

/**
 * The row's width and the widest words over a hand's corner in it (its stake or owner and its
 * total, or how it ended), as it lays out (0 until measured, and on the server render): every slot
 * keeps room for those words. They never shrink while the row keeps its hands, so the slots never
 * flip back and forth.
 */
function useRowSize<T extends HTMLElement>(count: number, words = true): [RefObject<T | null>, { width: number; head: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, head: 0 });
  // A new number of hands starts the words' width over.
  const counted = useRef(count);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const fresh = counted.current !== count;
    counted.current = count;
    const width = el.clientWidth;
    const said = words ? headWidth(el) : 0;
    setSize((s) => {
      const head = fresh ? said : Math.max(s.head, said);
      return s.width === width && s.head === head ? s : { width, head };
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
  const [ref, box] = useRowSize<HTMLDivElement>(hands.length, !mini);
  const [fade, refade] = useScrollFade(ref, true, 'x');
  // A new hand or a new size changes what the row holds, which the fade's own observer cannot see.
  useLayoutEffect(refade);
  useFollowHand(ref, activeIndex, hands.length, `${box.width} ${box.head}`);
  const style = { ...fanStyle(hands), '--bj-head-w': `${box.head}px` } as CSSProperties;
  const named = activeIndex >= 0 ? activeIndex : 0;
  const side = hands.length > 1;
  return (
    <div ref={ref} className={`bj-hands bj-hands--${place} scroll-fade scroll-fade--x${side ? ' bj-hands--side' : ''}`} style={style} data-testid={`${testId}s-row`} data-count={hands.length} data-fade={fade}>
      {hands.map((hand, i) => (
        // Each slot keeps the room its own hand's words reach left of its own fan (blackjack.css --bj-head-room).
        <div key={i} className="bj-slot" style={{ '--slot-fan': Math.max(2, hand.cards.length) } as CSSProperties}>
          <Hand playerId={playerId} index={i} hand={hand} start={start} timeline={timeline} now={now} leaving={leaving} size={size} active={i === activeIndex} mini={mini} narrow={side} stake={stakes} ownerName={i === named ? ownerName : undefined} testId={testId} />
        </div>
      ))}
    </div>
  );
}
