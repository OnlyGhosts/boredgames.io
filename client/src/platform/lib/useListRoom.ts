import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const LIST_CAP_VAR = '--list-cap';
/** Clear of the screen's top edge, and between the list and the block under it, when the page is scrolled to show them both. */
export const LIST_EDGE = 16;
/** How much of the next row a capped list shows under its fade: the sign that more rows follow, with the "+N more" pill over it. */
export const LIST_PEEK = 28;
/** A capped list still shows this many whole rows, however short the window. */
export const LIST_MIN_ROWS = 3;

export interface ListCapInput {
  /** The most the list's box may take once the page is scrolled to it: the window less what stays under the list (Start's block, or a phone's pinned footer) and an edge above and below (roomForList). */
  room: number;
  /** The room under the box's own top at the page's rest, less the block under it and an edge under that (restForList): a box that fits here shows with its "+N more" and Start without a page scroll. */
  rest: number;
  /** Each row's bottom edge, measured from the top of the list's box (its top border included), in order. */
  rowBottoms: readonly number[];
  /** The box's bottom border. */
  border: number;
}

/**
 * How tall the player list may be: null for every row (the page holds the whole list with Start
 * under it, scrolling if it must), else the box's height in whole rows plus LIST_PEEK of the next.
 * The box takes the room under its own top at the page's rest wherever that holds LIST_MIN_ROWS
 * whole rows and the peek, so the box, its "+N more" and Start all show at the page's top, with the
 * list the one thing to scroll; a list that sits lower on the page (a short laptop window, a phone)
 * takes the window's room instead, the page scrolled to it. Never fewer than LIST_MIN_ROWS whole
 * rows, and never a row ending partway without the faded peek and its "+N more" over it. A box
 * that would hide a single row is not worth a scroll of its own (it saves less than a row): the
 * whole list shows instead, a little past the room.
 */
export function listCap({ room, rest, rowBottoms, border }: ListCapInput): number | null {
  const n = rowBottoms.length;
  if (rowBottoms[n - 1] + border <= room) return null;
  const holds = (space: number) => {
    let shown = 0;
    while (shown < n - 1 && rowBottoms[shown] + LIST_PEEK + border <= space) shown += 1;
    return shown;
  };
  const atRest = holds(rest);
  const shown = Math.max(atRest >= LIST_MIN_ROWS ? atRest : holds(room), LIST_MIN_ROWS);
  if (shown >= n - 1) return null;
  return Math.ceil(rowBottoms[shown - 1] + LIST_PEEK + border);
}

/** The window less what must stay on the screen with the list once the page is scrolled to it: the block under it (and the gap above that block), an edge above the list and one under the block. */
export function roomForList(viewHeight: number, below: number): number {
  return Math.floor(viewHeight - below - 2 * LIST_EDGE);
}

/** The room under the list's top at the page's rest (`top`: the box's top from the page's top): the window less that, the block under the list (and the gap above it) and an edge under the block. */
export function restForList(viewHeight: number, top: number, below: number): number {
  return Math.floor(viewHeight - top - below - LIST_EDGE);
}

export interface ListRoom {
  /** The list scrolls inside its box. */
  capped: boolean;
  /** Rows not wholly shown under the box's bottom edge: the "+N more" pill. */
  below: number;
  /** The list is scrolled down from its top: the top edge fades too. */
  above: boolean;
}

const NONE: ListRoom = { capped: false, below: 0, above: false };

/**
 * Keeps the player list and the block under it (Start or Ready and the row under it) on the screen
 * together: measures what stays under the list (`block`, the column's block under it, or the phone's
 * footer pinned to the screen's foot, `pinned`) and where the list sits on the page, publishes the
 * list's height as `--list-cap` on `root` (see `listCap`; none while the whole list fits) and
 * reports what the list hides as it scrolls. Measured after every render (a player joins, a confirm
 * step opens), on a resize, when the page reflows (the fonts arriving) and as the list scrolls.
 */
export function useListRoom(root: RefObject<HTMLElement | null>, list: string, block: string, pinned: boolean): ListRoom {
  const [state, setState] = useState<ListRoom>(NONE);
  const measure = () => {
    const el = root.current;
    if (!el) return;
    const listEl = el.querySelector<HTMLElement>(list);
    const blockEl = el.querySelector<HTMLElement>(block);
    if (!listEl || !blockEl) {
      el.style.removeProperty(LIST_CAP_VAR);
      setState(NONE);
      return;
    }
    const box = listEl.getBoundingClientRect();
    const under = blockEl.getBoundingClientRect();
    const style = getComputedStyle(listEl);
    const rows = [...listEl.children].filter((child) => child.tagName === 'LI');
    const rowBottoms = rows.map((row) => row.getBoundingClientRect().bottom - box.top + listEl.scrollTop);
    // Pinned, the footer stays at the screen's foot whatever the page does; else the block follows the list, and the gap between them counts.
    const below = pinned ? under.height : under.bottom - box.bottom;
    // The box's top from the page's top: where it sits at the page's rest, whatever the page is scrolled to now.
    const top = box.top + window.scrollY;
    const cap = listCap({ room: roomForList(window.innerHeight, below), rest: restForList(window.innerHeight, top, below), rowBottoms, border: parseFloat(style.borderBottomWidth) || 0 });
    const value = cap === null ? '' : `${cap}px`;
    if (el.style.getPropertyValue(LIST_CAP_VAR) !== value) {
      if (value) el.style.setProperty(LIST_CAP_VAR, value);
      else el.style.removeProperty(LIST_CAP_VAR);
    }
    // What the box hides, from the layout as it now stands (the cap just set applies at once).
    const shown = listEl.getBoundingClientRect();
    const capped = listEl.scrollHeight > listEl.clientHeight + 1;
    const hidden = capped ? rows.filter((row) => row.getBoundingClientRect().bottom > shown.bottom + 0.5).length : 0;
    const above = capped && listEl.scrollTop > 1;
    setState((prev) => (prev.capped === capped && prev.below === hidden && prev.above === above ? prev : { capped, below: hidden, above }));
  };
  const latest = useRef(measure);

  useLayoutEffect(() => {
    latest.current = measure;
    measure();
  });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => latest.current();
    window.addEventListener('resize', update);
    // The list's own scroll (scroll events do not bubble: caught on the way down).
    el.addEventListener('scroll', update, { capture: true, passive: true });
    // The fonts arriving or the picker reflowing move the list without a render.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      el.removeEventListener('scroll', update, { capture: true });
      observer?.disconnect();
    };
  }, [root]);

  return state;
}
