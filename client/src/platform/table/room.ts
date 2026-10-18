import { useLayoutEffect, useState, type RefObject } from 'react';
import { TURN_CLOCK, TURN_WRAP, seatsSpare } from './grid';

/**
 * The room a calm table's seats have, read the same way by the players grid (its tier) and by the
 * table (what the cards may take of it on a phone).
 */

/** What the table's cards may take on a phone, in px: written on the felt by useSeatRoom, read by the game's card rule. */
export const SPARE_VAR = '--tbl-spare';
/** How much the cards have grown past their least size, in px of the table's height: the game's CSS works it out. */
export const GROW_VAR = '--tbl-grow';

/**
 * The height the table's rows take, `spans` being each row's top and bottom: pieces laid side by
 * side in one row (the round and whose turn it is beside the dealer on the shortest phones) count
 * once, as the row they share.
 */
export function rowsTaken(spans: readonly { top: number; bottom: number }[]): { height: number; rows: number } {
  const sorted = [...spans].sort((a, b) => a.top - b.top);
  let height = 0;
  let rows = 0;
  let top = 0;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const span of sorted) {
    if (span.top < bottom - 0.5) {
      bottom = Math.max(bottom, span.bottom);
      continue;
    }
    if (rows > 0) height += bottom - top;
    rows += 1;
    top = span.top;
    bottom = span.bottom;
  }
  if (rows > 0) height += bottom - top;
  return { height, rows };
}

/**
 * The height `table` leaves `seats` (or, without them, leaves empty): its inner height less the
 * rows beside them (the head, the ribbon, the stage) and the gaps between. The corners floating
 * over the table (absolutely placed) take no row.
 */
export function roomLeft(table: HTMLElement, seats: Element | null): number {
  const style = getComputedStyle(table);
  const spans: { top: number; bottom: number }[] = [];
  for (const child of Array.from(table.children)) {
    if (child === seats) continue;
    const own = getComputedStyle(child);
    if (own.position === 'absolute' || own.position === 'fixed' || own.display === 'none') continue;
    const r = child.getBoundingClientRect();
    spans.push({ top: r.top, bottom: r.bottom });
  }
  const { height, rows } = rowsTaken(spans);
  const all = rows + (seats ? 1 : 0);
  const inner = table.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  return Math.max(0, inner - height - Math.max(0, all - 1) * (parseFloat(style.rowGap) || 0));
}

/** The count of other seats a round is laid out for, and the round it was read in. */
export interface SeatLatch<K> {
  round: K;
  count: number;
}

/**
 * The seats a round's cards are sized for: the count as the round on the table began. Nobody takes
 * a seat in the middle of a game (a newcomer watches until the next one), but a player who leaves
 * goes at once: the count read when the round changed stands until the next, so the cards never
 * resize in a round. A count that rises all the same is taken at once, so the seats never run out
 * of room.
 */
export function latchSeats<K>(prev: SeatLatch<K> | null, round: K, count: number): SeatLatch<K> {
  if (prev === null || prev.round !== round || count > prev.count) return { round, count };
  return prev;
}

interface SeatRoomOptions<K> {
  /** The round of the cards on show (Blackjack's round, Poker's hand). */
  round: K;
  /** The other seats at the table now. */
  count: number;
  /** A desktop's tiles. */
  wide: boolean;
  /** The line under the ribbon carries a turn clock (Poker). */
  clock?: boolean;
}

/**
 * Works out what a calm table's cards may take on a phone, and writes it on the felt as
 * `--tbl-spare` (px): the room the seats would have with the cards at their least size (the room
 * now, plus what the cards have grown, `--tbl-grow`), less what the seats the round was dealt with
 * need (grid.ts seatsNeed). Read when the table first lays out, when the round's seats change and
 * when the felt changes size (the screen turns; a watcher takes a seat at a new round and gets the
 * bet controls): never as the ribbon or the seats change within a round, and the panel under the
 * felt keeps one height through a round (a watching host's row of buttons too), so the cards hold
 * their size through every phase. Until then (and on the server render) it is 0: the cards at
 * their least size. Returns the seats it planned for.
 */
export function useSeatRoom<K>(felt: RefObject<HTMLElement | null>, { round, count, wide, clock = false }: SeatRoomOptions<K>): number {
  const [latch, setLatch] = useState<SeatLatch<K>>(() => ({ round, count }));
  const next = latchSeats(latch, round, count);
  if (next !== latch) setLatch(next);
  const seats = next.count;
  const growth = TURN_WRAP + (clock ? TURN_CLOCK : 0);
  useLayoutEffect(() => {
    const el = felt.current;
    if (!el) return undefined;
    const write = () => {
      const grid = el.querySelector(':scope > .tbl-grid');
      const style = getComputedStyle(el);
      const width = grid ? grid.clientWidth : el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const height = roomLeft(el, grid) + (parseFloat(style.getPropertyValue(GROW_VAR)) || 0);
      const value = `${seatsSpare(seats, { width, height }, { wide, growth })}px`;
      if (el.style.getPropertyValue(SPARE_VAR) !== value) el.style.setProperty(SPARE_VAR, value);
    };
    write();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(write) : null;
    observer?.observe(el);
    // The fonts arriving after the first layout change the ribbon's height once: read it again then.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) write();
    });
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [felt, seats, wide, growth]);
  return seats;
}
