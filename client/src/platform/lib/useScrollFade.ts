import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Which ends of a scrolling box have more to read: each fades out there, so a line cut at the edge
 * reads as a scroll. A box that scrolls sideways (axis `x`: Blackjack's row of hands) names its
 * left and right ends.
 */
export type Fade = '' | 'top' | 'bottom' | 'top bottom' | 'left' | 'right' | 'left right';

/** The way a `.scroll-fade` box scrolls: down (`y`, the bands at its top and bottom) or sideways (`x`, `.scroll-fade--x`). */
export type FadeAxis = 'x' | 'y';

/**
 * How wide a sideways box's content is as laid out: the right edge of its furthest child plus its
 * end padding. Unlike `scrollWidth` it leaves out a child's moving parts (a dealt card still in the
 * air reaches past its hand for a moment), so the fades and a scroll to a hand never chase them.
 */
export function laidOutWidth(el: HTMLElement): number {
  const box = el.getBoundingClientRect();
  let right = 0;
  for (const child of el.children) right = Math.max(right, child.getBoundingClientRect().right - box.left + el.scrollLeft);
  return Math.max(el.clientWidth, Math.ceil(right + (parseFloat(getComputedStyle(el).paddingRight) || 0)));
}

/** The fades of a sideways box scrolled `scrollLeft` into `content` px of hands, `view` px wide. */
export function sideFade(scrollLeft: number, view: number, content: number): Fade {
  const left = scrollLeft > 1;
  const right = scrollLeft + view < content - 1;
  return left && right ? 'left right' : left ? 'left' : right ? 'right' : '';
}

export function fadeOf(el: HTMLElement, axis: FadeAxis = 'y'): Fade {
  if (axis === 'x') return sideFade(el.scrollLeft, el.clientWidth, laidOutWidth(el));
  const top = el.scrollTop > 1;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  return top && bottom ? 'top bottom' : top ? 'top' : bottom ? 'bottom' : '';
}

/**
 * The fades of the scrolling box in `ref` (a `.scroll-fade` box: the stylesheet draws a band of the
 * surface at each end named in its `data-fade`), following its scrolling, its size and its content's
 * (a player joining, the card settling); `refresh` remeasures at once, for a change the box cannot
 * see itself (a new placement). A box that comes and goes (a sheet's body) passes whether it is in
 * the page as `mounted`, so the fades take it up when it appears; one that scrolls sideways passes
 * `axis` `x`. Returns what to put in `data-fade` and that `refresh`.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, mounted = true, axis: FadeAxis = 'y'): [fade: string | undefined, refresh: () => void] {
  const [fade, setFade] = useState<Fade>('');
  const refresh = useCallback(() => {
    const el = ref.current;
    setFade(el ? fadeOf(el, axis) : '');
  }, [ref, axis]);
  // Before the first paint, so a box that opens already full shows its band at once.
  useLayoutEffect(refresh, [refresh, mounted]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !mounted) return;
    el.addEventListener('scroll', refresh, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', refresh);
      observer?.disconnect();
    };
  }, [ref, refresh, mounted]);
  return [fade || undefined, refresh];
}
