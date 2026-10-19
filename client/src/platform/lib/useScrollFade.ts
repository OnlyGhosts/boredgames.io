import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Which ends of a scrolling box have more to read: each fades out there, so a line cut at the edge reads as a scroll. */
export type Fade = '' | 'top' | 'bottom' | 'top bottom';

export function fadeOf(el: HTMLElement): Fade {
  const top = el.scrollTop > 1;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  return top && bottom ? 'top bottom' : top ? 'top' : bottom ? 'bottom' : '';
}

/**
 * The fades of the scrolling box in `ref` (a `.scroll-fade` box: the stylesheet draws a band of the
 * surface at each end named in its `data-fade`), following its scrolling, its size and its content's
 * (a player joining, the card settling); `refresh` remeasures at once, for a change the box cannot
 * see itself (a new placement). A box that comes and goes (a sheet's body) passes whether it is in
 * the page as `mounted`, so the fades take it up when it appears. Returns what to put in
 * `data-fade` and that `refresh`.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, mounted = true): [fade: string | undefined, refresh: () => void] {
  const [fade, setFade] = useState<Fade>('');
  const refresh = useCallback(() => {
    const el = ref.current;
    setFade(el ? fadeOf(el) : '');
  }, [ref]);
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
