import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Words on a seat's tile that must read whole at every tile width (Poker's "Raise to 12,000", a
 * stack of "100,000 chips"): a text has forms, the fullest first and each shorter than the one
 * before ("Raise to 12,000", "Raise 12k", "Raise"), and the tile shows the first that fits its box
 * as it lays out. Never cut, never an ellipsis.
 */

/** Its content is wider than its box: shown as it is, it would be cut. */
export function overflows(el: { scrollWidth: number; clientWidth: number }): boolean {
  return el.scrollWidth > el.clientWidth + 0.5;
}

/**
 * The form to show after one look at the box: the next, shorter one while the box overflows and
 * there is one; otherwise the same.
 */
export function nextForm(at: number, count: number, cut: boolean): number {
  return cut && at < count - 1 ? at + 1 : at;
}

/** Two boxes lie over each other: more than a half-pixel touch both ways. */
export function meets(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
}

/** The tile a text sits on: the box whose size its room follows. */
export function tileOf(el: Element): Element | null {
  return el.closest('.tbl-tile');
}

/** The stage a stake by my hand sits on (TableStage). */
export function stageOf(el: Element): Element | null {
  return el.closest('.tbl-stage');
}

/**
 * A stake by my hand that runs off the stage, or pushes its hand off it: the pill or the hand it
 * belongs to reaches past the stage's left or right edge (my next stake beside my empty places on
 * a narrow phone; Poker's words, which widen the hand's own box).
 */
export function offStage(el: Element): boolean {
  const stage = stageOf(el)?.getBoundingClientRect();
  if (!stage) return false;
  return [el, el.closest('.tbl-hand')].some((part) => {
    const r = part?.getBoundingClientRect();
    return r !== undefined && r.width > 0 && (r.left < stage.left - 0.5 || r.right > stage.right + 0.5);
  });
}

/** Where a measured figure's room comes from (`box`, whose size its room follows) and what counts as not fitting (`cut`). */
export interface FitRule {
  box: (el: Element) => Element | null;
  cut: (el: HTMLElement) => boolean;
}

/** A stake by my hand on the stage: short only where the full figure would run it, or its hand, off the stage. */
export const STAGE_FIT: FitRule = { box: stageOf, cut: offStage };

/**
 * A stack on a seat's tile that does not read whole: cut in its own box, or run under the name
 * over it. A full tile before the deal keeps one line for the stack and the bet: "1,250,000 chips"
 * and a pill of chips and a plus wrap onto a second it has no room for, and the stack rose under
 * the name.
 */
export function crowdsTile(el: HTMLElement): boolean {
  if (overflows(el)) return true;
  const name = tileOf(el)?.querySelector('.tbl-tile__name-text');
  return !!name && meets(el.getBoundingClientRect(), name.getBoundingClientRect());
}

/** A stack on a tile: short only where the full figure would be cut or run under the name. */
export const TILE_FIT: FitRule = { box: tileOf, cut: crowdsTile };

/**
 * The room a text had when its form was found cut: its own box's width, and the size of each of
 * its siblings (the bet pill beside a seat's line; the total beside a stake over my hand), which
 * share its row.
 */
export interface Room<E = Element> {
  width: number;
  kin: { el: E; width: number; height: number }[];
}

/** The room `el` has now (Room). */
export function roomOf(el: Element): Room {
  const kin = Array.from(el.parentElement?.children ?? [])
    .filter((c) => c !== el)
    .map((c) => {
      const r = c.getBoundingClientRect();
      return { el: c, width: r.width, height: r.height };
    });
  return { width: el.clientWidth, kin };
}

/**
 * The text may have more room now than when its form was found cut (`then`): its own box is
 * wider, or a sibling is narrower or shorter, or gone (Poker's "+ 12,000" pill shrinks to its
 * chips as the street closes, and the line squeezed beside it has the row again). A shorter form
 * of the text never gives it this (its own box can only shrink for it, its siblings only grow),
 * so starting over whenever this holds can never loop.
 */
export function freed<E>(then: Room<E>, now: Room<E>): boolean {
  if (now.width > then.width + 0.5) return true;
  return then.kin.some((k) => {
    const same = now.kin.find((n) => n.el === k.el);
    return !same || same.width < k.width - 0.5 || same.height < k.height - 0.5;
  });
}

/** A box's size as a key, to a tenth of a pixel. */
function sizeKey(width: number, height: number): string {
  return `${Math.round(width * 10)}x${Math.round(height * 10)}`;
}

/**
 * A ResizeObserver that calls `onChange` for a change of any target's size since it was observed
 * (its border box then, against each report's), so a box that grows before its first report (the
 * stage, as the cards grow into the room the seats leave, in the same commit the pill over it
 * began watching it) counts too. A browser whose reports carry no border box compares content
 * boxes from the first report on.
 */
function watching(onChange: () => void): { observe(el: Element): void; disconnect(): void } {
  let seen = new Map<Element, string>();
  const observer = new ResizeObserver((entries) => {
    let changed = false;
    for (const e of entries) {
      const was = seen.get(e.target);
      const box = e.borderBoxSize?.[0];
      const now = box ? sizeKey(box.inlineSize, box.blockSize) : `content ${sizeKey(e.contentRect.width, e.contentRect.height)}`;
      if (was !== undefined && now !== was.replace(/^seen /, '') && (box || !was.startsWith('seen '))) changed = true;
      seen.set(e.target, now);
    }
    if (changed) onChange();
  });
  return {
    observe: (el) => {
      const r = el.getBoundingClientRect();
      seen.set(el, `seen ${sizeKey(r.width, r.height)}`);
      observer.observe(el);
    },
    disconnect: () => {
      observer.disconnect();
      seen = new Map<Element, string>();
    },
  };
}

/**
 * Which of `count` forms of a text to show in `ref`'s element (`key` names the forms): the first
 * that fits whole. While the element is `cut` (its box overflows, by default) it steps to the next
 * form, before the browser paints. It starts again from the fullest when `box` (the element whose
 * size the text's room follows: the tile, the stage) changes size, when the fonts arrive, when
 * the forms change, and when the text's own row gives it more room than it had when its form was
 * found cut (`freed`: a wider box of its own, a sibling smaller or gone); a change of its row that
 * gives it no more room only looks at the form on show again, so it steps further if that is cut
 * now. Every start is a fresh look at the fullest form, whatever form was on show (the stage's
 * resize once did nothing while the full figure was on show, and a stake it then pushed 2px off
 * the stage stayed in full). The server render, and a page that never lays out, show the first.
 */
export function useFitForm(ref: RefObject<HTMLElement | null>, key: string, count: number, box: (el: Element) => Element | null, cut: (el: HTMLElement) => boolean = overflows): number {
  // `run` counts the looks: each new one renders again, so the form on show is measured again even when it is the fullest.
  const [fit, setFit] = useState({ key, at: 0, run: 0 });
  const at = fit.key === key ? Math.min(fit.at, Math.max(0, count - 1)) : 0;
  // The room the form on show was last found cut in; null while the fullest form fits.
  const room = useRef<Room | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || count < 2) return;
    const isCut = cut(el);
    if (isCut) room.current = roomOf(el);
    else if (at === 0) room.current = null;
    const next = nextForm(at, count, isCut);
    if (next !== at) setFit({ key, at: next, run: fit.run });
  });
  useLayoutEffect(() => {
    const el = ref.current;
    const watched = el ? box(el) : null;
    if (!el || !watched || count < 2 || typeof ResizeObserver !== 'function') return undefined;
    const restart = () => {
      room.current = null;
      setFit((f) => ({ key: f.key, at: 0, run: f.run + 1 }));
    };
    const again = () => setFit((f) => ({ ...f, run: f.run + 1 }));
    // The row changed: start over where the text may have more room, else look at the form on show again.
    const rowChanged = () => (room.current !== null && freed(room.current, roomOf(el)) ? restart() : again());
    const boxWatch = watching(restart);
    boxWatch.observe(watched);
    // The text's own box and its siblings', the row it shares with them.
    const rowWatch = watching(rowChanged);
    const parent = el.parentElement;
    const watchRow = () => {
      rowWatch.disconnect();
      for (const part of parent ? Array.from(parent.children) : [el]) rowWatch.observe(part);
    };
    watchRow();
    // A sibling comes or goes (a tile's bet pill, between rounds): watch the new row, and look again.
    const rowKeeper =
      parent && typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            watchRow();
            rowChanged();
          })
        : null;
    if (parent) rowKeeper?.observe(parent, { childList: true });
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) restart();
    });
    return () => {
      live = false;
      boxWatch.disconnect();
      rowWatch.disconnect();
      rowKeeper?.disconnect();
    };
  }, [ref, box, count]);
  return at;
}

interface FitTextProps {
  /**
   * The text's forms, the fullest first: the one the server render shows, and the one a tile's
   * open button repeats in its label (PlayerTile) whatever form is on show.
   */
  forms: readonly string[];
  className?: string;
  testId?: string;
  /** The box whose size the text's room follows (the tile it sits on). */
  box?: (el: Element) => Element | null;
}

/** A line that shows the first of its forms that fits its box whole (useFitForm). */
export function FitText({ forms, className, testId, box = tileOf }: FitTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const at = useFitForm(ref, forms.join('\n'), forms.length, box);
  return (
    <span ref={ref} className={className} data-testid={testId} data-fit={forms.length > 1 ? at : undefined}>
      {forms[at] ?? ''}
    </span>
  );
}
