import { useEffect } from 'react';

export const APP_HEIGHT_VAR = '--app-height';
/** Set on <html> while a screen wants the page itself to never scroll (the phone game layout). */
export const APP_MODE_CLASS = 'is-app';
/** Set on <html> while the on-screen keyboard is open: a text field has focus and the visible height dropped. */
export const KEYBOARD_CLASS = 'is-keyboard';
/** The least a keyboard takes off the visible height; an address bar folding away takes less. */
const KEYBOARD_MIN_PX = 120;
const NOT_TYPED_INTO = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** Whether the focused element brings up the on-screen keyboard. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NOT_TYPED_INTO.has((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Whether the keyboard is open: a text field has focus and the visible height is well under the
 * tallest seen at this width (the keyboard closed). A new width (the phone turned) starts afresh.
 */
export function keyboardOpen(height: number, tallest: number, typing: boolean): boolean {
  return typing && height <= tallest - KEYBOARD_MIN_PX;
}

function visibleHeight(): number {
  const vv = window.visualViewport;
  const h = vv?.height ?? window.innerHeight;
  return Math.max(0, Math.round(h));
}

/**
 * Publishes the visible viewport height as `--app-height` on <html>. `100dvh` ignores the
 * on-screen keyboard on iOS, so the game's fixed layout sizes itself from the visual viewport
 * instead; when the keyboard resizes it, the page is re-anchored at the top so the layout does
 * not drift under the keyboard. While the keyboard is open <html> also carries `is-keyboard`, so a
 * layout can keep what matters (Scribble's canvas) at full size and let the rest give way: iOS
 * never shrinks the layout viewport, so no height media query sees its keyboard.
 */
export function useViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let lastHeight = -1;
    let width = -1;
    let tallest = 0;

    // While focus moves, activeElement is the body: a focusout passes where focus is going instead.
    const apply = (typing = isTypingTarget(document.activeElement)) => {
      const height = visibleHeight();
      root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tallest = height;
      } else tallest = Math.max(tallest, height);
      root.classList.toggle(KEYBOARD_CLASS, keyboardOpen(height, tallest, typing));
      const changed = lastHeight !== -1 && height !== lastHeight;
      lastHeight = height;
      if (!root.classList.contains(APP_MODE_CLASS)) return;
      // iOS scrolls the page to keep the focused input visible when the keyboard opens; with a
      // layout that already fits the visual viewport that only pushes the header out of view.
      if (changed || window.scrollY !== 0 || (vv?.offsetTop ?? 0) !== 0) window.scrollTo(0, 0);
    };

    const onChange = () => apply();
    const onFocusOut = (e: FocusEvent) => apply(isTypingTarget(e.relatedTarget as Element | null));
    apply();
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    vv?.addEventListener('resize', onChange);
    vv?.addEventListener('scroll', onChange);
    document.addEventListener('focusin', onChange);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      vv?.removeEventListener('resize', onChange);
      vv?.removeEventListener('scroll', onChange);
      document.removeEventListener('focusin', onChange);
      document.removeEventListener('focusout', onFocusOut);
      root.style.removeProperty(APP_HEIGHT_VAR);
      root.classList.remove(KEYBOARD_CLASS);
    };
  }, []);
}

/** Toggles the non-scrolling app mode on <html> while `active`. */
export function useAppMode(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add(APP_MODE_CLASS);
    window.scrollTo(0, 0);
    return () => root.classList.remove(APP_MODE_CLASS);
  }, [active]);
}
