import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { GameRules } from '../game';
import { noOrphan } from '../lib/format';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/media';
import { rulesProse, rulesSections } from '../lib/rules';
import { BottomSheet } from './BottomSheet';
import { CloseIcon, HelpIcon } from './Icons';
import { RulesHeroArt } from './RulesHero';

interface Props {
  meta: GameMeta;
  rules: GameRules;
  /**
   * An element whose presses leave the popover open (the host's game tiles: the card follows the switch instead of closing).
   * Its items other than the checked one are the tiles the card leaves a part of to press.
   */
  keepOpenIn?: RefObject<HTMLElement | null>;
}

/**
 * The lobby's How to play: a button beside the picked game that opens its rules. On a desktop a
 * popover card opens by the button, under, over or beside it (placePopover): inside the page's own
 * width, whole wherever a side of the button has the room and scrolling there where it has not
 * (never over its own button, the players and Start while a side holds most of it), never over the
 * room code, leaving each game the host could switch to a part to press, and with nothing dimming
 * the room under it; on a phone or tablet the rules come up in the bottom sheet. Either way the card follows the game the host
 * picks, Escape and the close button hand the focus back to the button, and a tap outside closes it.
 */
export function HowToPlay({ meta, rules, keepOpenIn }: Props) {
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  return (
    <div className="how-to-play">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--secondary how-to-play__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && desktop ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="how-to-play"
      >
        <HelpIcon size={18} /> How to play
      </button>
      <HowToPlayDialog meta={meta} rules={rules} open={open} mode={desktop ? 'popover' : 'sheet'} onClose={close} anchorRef={buttonRef} keepOpenIn={keepOpenIn} id={panelId} />
    </div>
  );
}

interface DialogProps {
  meta: GameMeta;
  rules: GameRules;
  open: boolean;
  mode: 'popover' | 'sheet';
  /** `refocus`: the close came from the keyboard or the close button, so the button takes the focus back. */
  onClose(refocus: boolean): void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  keepOpenIn?: RefObject<HTMLElement | null>;
  id?: string;
}

/** The open card in either shape; split from the button so each shape renders on its own in tests. */
export function HowToPlayDialog({ meta, rules, open, mode, onClose, anchorRef, keepOpenIn, id }: DialogProps) {
  const label = `How to play ${meta.name}`;
  if (mode === 'sheet') {
    return (
      <BottomSheet open={open} title="How to play" label={label} onClose={() => onClose(true)} testId="how-to-play-sheet" className="sheet--narrow">
        <RulesCard meta={meta} rules={rules} mode="sheet" />
      </BottomSheet>
    );
  }
  if (!open) return null;
  return <Popover meta={meta} rules={rules} label={label} onClose={onClose} anchorRef={anchorRef} keepOpenIn={keepOpenIn} id={id} />;
}

/**
 * The card's widest: the hero and the key facts across it, the five sections in two columns under
 * them (lobby.css, from POPOVER_TWO_COLUMNS). Under or over the button in a page column no wider
 * than this (a guest's, 880px on a desktop), the card hangs from the button's left edge to the
 * column's right edge, the players' rows left of it still in view.
 */
export const POPOVER_MAX_WIDTH = 880;
/** From this wide the card lays its sections out in two columns (lobby.css's container query). */
export const POPOVER_TWO_COLUMNS = 640;
/**
 * Over a wider page (the host's two columns) the card is this wide: two columns still, and narrow
 * enough, slid over the button from the page's right edge, to leave every other game tile a part to press.
 */
export const POPOVER_WIDTH = 760;
/** The narrowest the card goes beside its button: one column, as in the phone's sheet. */
export const POPOVER_MIN_WIDTH = 380;
/** Clear of the screen's edges, and under the room bar. */
const EDGE = 16;
/** Between the button and the card, where the arrow sits. */
const GAP = 10;
/** The least a scrolling card gets in a place that leaves Start and Ready (or the game tiles) showing: its head and about eight lines of rules. */
const MIN_HEIGHT = 200;
/** The least of a game tile the card leaves showing, across and down: the room's 44px target, enough to press. */
const REACH = 44;

/** A box on the screen, in CSS pixels from the viewport's top left. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the card sits against its button: under, over or beside it, or (the last resort) over the button itself. */
export type PopoverSide = 'below' | 'above' | 'right' | 'left' | 'over';

export interface PopoverPlacement {
  side: PopoverSide;
  /** The card's top left corner on the screen. */
  x: number;
  y: number;
  width: number;
  /** The card's height on the screen: all of it, or the room it has when it scrolls. */
  height: number;
  scrolls: boolean;
  /** Where the arrow meets the card's edge facing the button: from its left under or over the button, from its top beside it; none over the button. */
  arrow: number | null;
}

export interface PopoverRoom {
  /** The window. */
  view: { width: number; height: number };
  /** The page's own column, edge to edge (the room bar's): the card never runs past it, nor past the window's edges. */
  bounds: { left: number; right: number };
  /** The How to play button. */
  anchor: ScreenBox;
  /** The highest the card may reach: under the room bar, so the room code always shows (the screen's top edge once the bar has scrolled away). */
  ceiling: number;
  /** Start and Ready: under the player list, or the footer pinned to the foot of a short window. The card leaves them uncovered where it can (placePopover). */
  keepClear: ScreenBox | null;
  /** Start and Ready sit in that footer, pinned to a short window's foot: a card showing most of itself may run over them under the player list, never over the pinned footer (placePopover). */
  pinned?: boolean;
  /** The game tiles the host could switch to: a press there switches the game and the card follows, so the card leaves a part of each to press. */
  keepReach: readonly ScreenBox[];
  /** The card's whole height at a width (measured: its layout changes with its width). */
  heightAt(width: number): number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const overlaps = (a: ScreenBox, b: ScreenBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const boxOf = (p: PopoverPlacement): ScreenBox => ({ left: p.x, top: p.y, right: p.x + p.width, bottom: p.y + p.height });

/** A tile the card leaves a pressable part of: a strip at its left, right, top or bottom at least REACH across and REACH down. */
function leavesReach(card: ScreenBox, tile: ScreenBox): boolean {
  if (!overlaps(card, tile)) return true;
  const across = Math.max(card.left - tile.left, tile.right - card.right);
  const down = Math.max(card.top - tile.top, tile.bottom - card.bottom);
  return (across >= REACH && tile.bottom - tile.top >= REACH) || (down >= REACH && tile.right - tile.left >= REACH);
}

/** A stretch of the window the card may fill on one side of its button, from `top` to `bottom`. */
interface Slot {
  side: PopoverSide;
  x: number;
  width: number;
  top: number;
  bottom: number;
}

/**
 * Where the desktop card goes. Never over the room bar (the room code), never past the page's own
 * edges (the room bar's) or off the window, and in this order of what matters:
 * 1. The whole card, never cut, on a side of its button, leaving every game tile the host could
 *    switch to a part to press. It tries under the button and over it (in a page column up to
 *    POPOVER_MAX_WIDTH, from the button's left edge to the column's right; over a wider page
 *    POPOVER_WIDTH), then beside it (right, then left, as wide as the page leaves there, at most
 *    POPOVER_MAX_WIDTH). One clear of Start and Ready wins.
 * 2. Else a card on a side of the button showing most of itself, the rest scrolling (the common
 *    laptop windows: beside the host's button the page leaves one column, a little too tall for
 *    the window): the one showing the most. It may run over Start and Ready under the player
 *    list, as the whole card does (a guest's hangs over its own column), never over the footer
 *    pinned to a short window's foot.
 * 3. Else it scrolls where it has the most room and still leaves the tiles (at least MIN_HEIGHT),
 *    stopping short of Start and Ready wherever that still leaves it MIN_HEIGHT, so they stay in
 *    reach; with less room than that there it runs over them.
 * 4. Else (no side of the button holds even MIN_HEIGHT of it) the whole card slides up over the
 *    button, all of it, never half: from the page's right edge (over the host's settings), from
 *    the button's own place or from the page's left edge, whichever leaves the tiles, ending above
 *    Start and Ready where that still covers the button, else as low as it fits.
 * 5. Else (no place leaves the tiles) the whole card wherever it fits, a side of the button first;
 *    and last, in a window too short for the whole card anywhere, it scrolls where it has the
 *    most room.
 * So the card never sits over its own button (and, in the host's room, over the players' statuses
 * and Start) while a side of the button holds MIN_HEIGHT of it: rather a card that scrolls beside
 * the button than one that covers them.
 */
export function placePopover({ view, bounds, anchor, ceiling, keepClear, pinned = false, keepReach, heightAt }: PopoverRoom): PopoverPlacement {
  const floor = view.height - EDGE;
  const midX = (anchor.left + anchor.right) / 2;
  const midY = (anchor.top + anchor.bottom) / 2;
  // The page's edges, inside the window's.
  const pageLeft = Math.max(EDGE, bounds.left);
  const pageRight = Math.min(view.width - EDGE, bounds.right);
  const page = pageRight - pageLeft;
  // A guest's column: from the button's left edge to the column's right edge (the whole column if that is under two columns' worth).
  const fromButton = pageRight - Math.max(pageLeft, anchor.left);
  const width = page > POPOVER_MAX_WIDTH ? POPOVER_WIDTH : fromButton >= POPOVER_TWO_COLUMNS ? fromButton : page;
  const whole = heightAt(width);
  // Under or over the button the card hangs from its left edge, or from its right where the page ends first.
  const x = anchor.left + width <= pageRight ? anchor.left : anchor.right - width >= pageLeft ? anchor.right - width : clamp(midX - width / 2, pageLeft, pageRight - width);
  const arrowX = clamp(midX - x, 16, width - 16);

  // The sides of the button: under and over it at the card's widest; beside it as wide as the page leaves, from under the room bar to the window's foot.
  const slots: Slot[] = [
    { side: 'below', x, width, top: anchor.bottom + GAP, bottom: floor },
    { side: 'above', x, width, top: ceiling, bottom: anchor.top - GAP },
  ];
  const rightWidth = Math.min(POPOVER_MAX_WIDTH, pageRight - anchor.right - GAP);
  const leftWidth = Math.min(POPOVER_MAX_WIDTH, anchor.left - GAP - pageLeft);
  if (rightWidth >= POPOVER_MIN_WIDTH) slots.push({ side: 'right', x: anchor.right + GAP, width: rightWidth, top: ceiling, bottom: floor });
  if (leftWidth >= POPOVER_MIN_WIDTH) slots.push({ side: 'left', x: anchor.left - GAP - leftWidth, width: leftWidth, top: ceiling, bottom: floor });

  // The card in a slot down to `bottom`: under the button it hangs from the slot's top, over it from its foot, beside it centred on the button where it can be.
  const put = ({ side, x: left, width: w, top }: Slot, bottom: number): PopoverPlacement => {
    const natural = heightAt(w);
    const room = Math.max(0, bottom - top);
    const height = Math.min(natural, room);
    if (side === 'below' || side === 'above') return { side, x: left, y: side === 'below' ? top : bottom - height, width: w, height, scrolls: natural > room, arrow: arrowX };
    const y = Math.round(clamp(midY - height / 2, top, bottom - height));
    return { side, x: left, y, width: w, height, scrolls: natural > room, arrow: clamp(midY - y, 16, height - 16) };
  };

  const places: PopoverPlacement[] = [];
  for (const slot of slots) {
    // First stopping short of Start and Ready where they cut into the slot under the card's top (beside the button, only while the
    // card still reaches the button's middle, where its arrow points), then down to the slot's foot.
    const stop = keepClear && slot.side !== 'above' && keepClear.left < slot.x + slot.width && slot.x < keepClear.right ? keepClear.top - EDGE : null;
    if (stop !== null && stop > slot.top && stop < slot.bottom && (slot.side === 'below' || stop >= midY + 16)) places.push(put(slot, stop));
    places.push(put(slot, slot.bottom));
  }
  // Over the button, whole, covering all of it, never half: ending 16px above Start and Ready where that still covers the button,
  // else its top 10px over the button's (or higher, as low as it fits). From the page's right edge first, over the host's settings.
  if (whole <= floor - ceiling) {
    const low = Math.max(ceiling, Math.min(floor - whole, anchor.top - GAP));
    const high = keepClear ? keepClear.top - EDGE - whole : null;
    const ys = high !== null && high >= ceiling && high < low && high + whole >= anchor.bottom ? [high, low] : [low];
    for (const left of [pageRight - width, x, pageLeft]) {
      if (left > anchor.left || left + width < anchor.right || places.some((p) => p.side === 'over' && p.x === left)) continue;
      for (const y of ys) places.push({ side: 'over', x: left, y, width, height: whole, scrolls: false, arrow: null });
    }
  }

  const clear = (p: PopoverPlacement) => !keepClear || !overlaps(boxOf(p), keepClear);
  const reaches = (p: PopoverPlacement) => keepReach.every((tile) => leavesReach(boxOf(p), tile));
  const beside = (p: PopoverPlacement) => p.side !== 'over';
  /** How much of the card a placement shows: all of it, or the part of it its room holds. */
  const shown = (p: PopoverPlacement) => p.height / heightAt(p.width);
  // Of whole cards: clear of the button before over it, then clear of Start and Ready, then the order tried.
  const best = (list: PopoverPlacement[]) => list.find((p) => beside(p) && clear(p)) ?? list.find(beside) ?? list.find(clear) ?? list.at(0);
  // Of scrolling cards showing most of themselves (and not over a pinned footer): the one showing the most (the first of equals).
  const most = (list: PopoverPlacement[]) =>
    list.filter((p) => shown(p) > 1 / 2 && (clear(p) || !pinned)).reduce<PopoverPlacement | undefined>((top, p) => (!top || shown(p) > shown(top) ? p : top), undefined);
  // Of scrolling cards: the roomiest of those clear of Start and Ready with MIN_HEIGHT, else the roomiest (the first of equals).
  const roomiest = (list: PopoverPlacement[]) => {
    const short = list.filter((p) => clear(p) && p.height >= MIN_HEIGHT);
    return (short.length > 0 ? short : list).reduce<PopoverPlacement | undefined>((top, p) => (!top || p.height > top.height ? p : top), undefined);
  };
  const wholes = places.filter((p) => !p.scrolls);
  // The cards on a side of the button that scroll (a card over the button is always whole).
  const scrolling = places.filter((p) => p.scrolls);
  const over: PopoverPlacement = { side: 'over', x, y: ceiling, width, height: Math.max(0, floor - ceiling), scrolls: true, arrow: null };
  return (
    best(wholes.filter((p) => beside(p) && reaches(p))) ??
    most(scrolling.filter(reaches)) ??
    roomiest(scrolling.filter((p) => reaches(p) && p.height >= MIN_HEIGHT)) ??
    best(wholes.filter(reaches)) ??
    best(wholes) ??
    roomiest([...places, over]) ??
    over
  );
}

interface PopoverProps {
  meta: GameMeta;
  rules: GameRules;
  label: string;
  onClose(refocus: boolean): void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  keepOpenIn?: RefObject<HTMLElement | null>;
  id?: string;
}

/** Which ends of the scrolling rules have more to read: each fades out there, so a cut line reads as a scroll. */
type Fade = '' | 'top' | 'bottom' | 'top bottom';

function fadeOf(el: HTMLElement): Fade {
  const top = el.scrollTop > 1;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  return top && bottom ? 'top bottom' : top ? 'top' : bottom ? 'bottom' : '';
}

function Popover({ meta, rules, label, onClose, anchorRef, keepOpenIn, id }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The latest callback without re-arming the listeners on every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const [fade, setFade] = useState<Fade>('');

  // Measured before the first paint, again on a resize and when the host switches the game (another card, another height).
  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      const anchorBox = anchorRef?.current?.getBoundingClientRect();
      if (!panel || !anchorBox) return;
      // The card's whole height at a width, laid out for real: a hidden copy of it at that width, uncapped and without the head,
      // measured and dropped at once. A fresh copy starts no transitions (the reduced-motion rule gives every property a brief one,
      // which would leave a restyled card reading its old size).
      const heights = new Map<number, number>();
      const heightAt = (width: number) => {
        let height = heights.get(width);
        if (height === undefined) {
          const probe = panel.cloneNode(true) as HTMLElement;
          probe.removeAttribute('id');
          probe.removeAttribute('data-testid');
          probe.setAttribute('aria-hidden', 'true');
          probe.classList.remove('how-to-play__popover--scrolls');
          probe.style.cssText = `visibility: hidden; left: 0; top: 0; width: ${width}px; max-height: none;`;
          panel.after(probe);
          height = Math.ceil(probe.getBoundingClientRect().height);
          probe.remove();
          heights.set(width, height);
        }
        return height;
      };
      const bar = document.querySelector('.lobby__top')?.getBoundingClientRect();
      const viewWidth = document.documentElement.clientWidth;
      // The host's tiles other than the picked one: the games a press there switches to, with the card following.
      const others = keepOpenIn?.current ? Array.from(keepOpenIn.current.children).filter((tile) => tile.getAttribute('aria-checked') !== 'true') : [];
      const actions = document.querySelector('.lobby__actions');
      const footer = document.querySelector('.lobby__footer');
      const next = placePopover({
        view: { width: viewWidth, height: window.innerHeight },
        // The page's own column: the room bar's edges.
        bounds: bar ? { left: bar.left, right: bar.right } : { left: 0, right: viewWidth },
        anchor: anchorBox,
        ceiling: Math.max(EDGE, (bar?.bottom ?? 0) + EDGE),
        // Start and Ready: under the player list in the room's two columns, else in the footer pinned to the window's foot.
        keepClear: (actions ?? footer)?.getBoundingClientRect() ?? null,
        pinned: !actions && footer !== null,
        keepReach: others.map((tile) => tile.getBoundingClientRect()),
        heightAt,
      });
      // The card is placed in its wrapper's box (the button's): from the screen to that box.
      const origin = (panel.offsetParent ?? panel.parentElement)?.getBoundingClientRect();
      setPlacement({ ...next, x: next.x - (origin?.left ?? 0), y: next.y - (origin?.top ?? 0) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef, keepOpenIn, meta.id]);

  // The fades follow the scroll and the box's size (a new placement, the card settling); another game's rules start from their top.
  const shownGame = useRef(meta.id);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (shownGame.current !== meta.id) {
      shownGame.current = meta.id;
      scroll.scrollTop = 0;
    }
    setFade(fadeOf(scroll));
  }, [placement, meta.id]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setFade(fadeOf(scroll)));
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      const inside = (el: Element | null | undefined) => el instanceof Node && e.target instanceof Node && el.contains(e.target);
      if (!inside(panelRef.current) && !inside(anchorRef?.current) && !inside(keepOpenIn?.current)) onCloseRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current(true);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, keepOpenIn]);

  const side = placement?.side ?? 'below';
  const scrolls = placement?.scrolls ?? false;
  // Until it is measured (before the first paint) the card keeps the stylesheet's place.
  const style = (placement ? { left: `${placement.x}px`, top: `${placement.y}px`, width: `${placement.width}px`, maxHeight: `${placement.height}px`, '--arrow': `${placement.arrow ?? 0}px` } : {}) as CSSProperties;
  return (
    <div
      className={`how-to-play__popover how-to-play__popover--${side}${scrolls ? ' how-to-play__popover--scrolls' : ''}`}
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label={label}
      id={id}
      style={style}
      data-testid="how-to-play-popover"
      data-side={side}
      data-scrolls={scrolls}
    >
      {/* The close button over the card's corner; a card that scrolls gets a head for it, so it never sits over the rules. */}
      <div className="how-to-play__head">
        {scrolls && (
          <span className="how-to-play__title" aria-hidden="true">
            How to play
          </span>
        )}
        <button type="button" className="icon-btn how-to-play__close" onClick={() => onClose(true)} aria-label="Close" data-testid="how-to-play-close">
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="how-to-play__scroll" ref={scrollRef} data-fade={fade || undefined} onScroll={(e) => setFade(fadeOf(e.currentTarget))}>
        <RulesCard meta={meta} rules={rules} mode="popover" />
      </div>
    </div>
  );
}

/**
 * The rules themselves: the hero (the game's illustration, name and summary on a wash of its
 * accent), the four key facts in tiles, then the five sections under coloured tab pills. The
 * game's accent and its text, wash and edge cuts come in as custom properties on the card.
 */
export function RulesCard({ meta, rules, mode }: { meta: GameMeta; rules: GameRules; mode: 'popover' | 'sheet' }) {
  const accent = {
    '--game-accent': `var(--game-${meta.id})`,
    '--game-accent-text': `var(--game-${meta.id}-text)`,
    '--game-accent-soft': `var(--game-${meta.id}-soft)`,
    '--game-accent-edge': `var(--game-${meta.id}-edge)`,
  } as CSSProperties;
  return (
    <div className="rules" style={accent} data-testid="how-to-play-card" data-game={meta.id} data-mode={mode}>
      {/* Hero and facts, then the sections: one column in the sheet and a narrow card, side by side in a wide one. */}
      <div className="rules__aside">
        <div className="rules-hero">
          <RulesHeroArt hero={rules.hero} meta={meta} />
          <div className="rules-hero__intro">
            <h3 className="rules__name" data-testid="rules-name">
              {noOrphan(meta.name)}
            </h3>
            <p className="rules__summary">{rulesProse(rules.summary)}</p>
          </div>
        </div>
        <section className="rules__section rules__section--facts" aria-label="Key facts">
          <h4 className="rules__heading">Key facts</h4>
          <div className="rules-facts" data-testid="rules-facts">
            {rules.facts.map((fact) => (
              <div key={fact.label} className="rules-fact" data-testid="rules-fact">
                <span className="rules-fact__label">{fact.label}</span>
                <span className="rules-fact__value">{fact.value}</span>
                <span className="rules-fact__note">{rulesProse(fact.note)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="rules__body">
        {rulesSections(rules).map((s) => (
          <section key={s.key} className="rules__section" data-testid="rules-section" data-section={s.key}>
            <h4 className={`rules__tab rules__tab--${s.tone}`}>{s.heading}</h4>
            <p className="rules__text">{rulesProse(s.text)}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
