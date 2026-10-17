import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export const LIST_ROOM_VAR = '--list-room';

/**
 * How much of the page is not the list: everything from the top down to the bottom of the block
 * under it, less the list itself, plus the padding under the block. A list capped at the screen
 * less this keeps the block on the screen; the list's own height cancels out, so the cap is stable.
 */
export function roomBesideList(blockBottom: number, scrollY: number, listHeight: number, paddingBelow: number): number {
  return Math.ceil(blockBottom + scrollY - listHeight + paddingBelow);
}

/**
 * Keeps a block under a scrolling list on the screen: publishes `--list-room` on `root`, the
 * page's padded column holding both (see `roomBesideList`), for a rule like
 * `max-height: calc(100dvh - var(--list-room))`. Measured after every render (a player joins, a
 * confirm step opens) and whenever the column or the window changes size.
 */
export function useListRoom(root: RefObject<HTMLElement | null>, list: string, block: string, enabled: boolean): void {
  const measure = () => {
    const el = root.current;
    if (!el) return;
    const listEl = el.querySelector(list);
    const blockEl = el.querySelector(block);
    if (!enabled || !listEl || !blockEl) {
      el.style.removeProperty(LIST_ROOM_VAR);
      return;
    }
    const padding = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    const room = `${roomBesideList(blockEl.getBoundingClientRect().bottom, window.scrollY, listEl.getBoundingClientRect().height, padding)}px`;
    if (el.style.getPropertyValue(LIST_ROOM_VAR) !== room) el.style.setProperty(LIST_ROOM_VAR, room);
  };
  const latest = useRef(measure);

  useLayoutEffect(() => {
    latest.current = measure;
    measure();
  });

  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    const update = () => latest.current();
    window.addEventListener('resize', update);
    // The fonts arriving or the picker reflowing move the list without a render.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [root, enabled]);
}
