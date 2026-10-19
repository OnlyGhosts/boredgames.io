import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Which ends of a scrolling box have more to read: each fades out there, so a line cut at the edge
 * reads as a scroll. A box that scrolls sideways (axis `x`: Blackjack's row of hands) names its
 * left and right ends.
 */
export type Fade = '' | 'top' | 'bottom' | 'top bottom' | 'left' | 'right' | 'left right';

/** The way a `.scroll-fade` box scrolls: down (`y`, the bands at its top and bottom) or sideways (`x`, `.scroll-fade--x`). */
export type FadeAxis = 'x' | 'y';

export function fadeOf(el: HTMLElement, axis: FadeAxis = 'y'): Fade {
  if (axis === 'x') {
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    return left && right ? 'left right' : left ? 'left' : right ? 'right' : '';
  }
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
