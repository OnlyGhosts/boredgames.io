import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { GameRules } from '../game';
import { noOrphan } from '../lib/format';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/media';
import { rulesSections } from '../lib/rules';
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
 * popover card opens by the button, under, over or beside it (placePopover): whole wherever the
 * window has the room, never over the room code, leaving each game the host could switch to a part
 * to press, and with nothing dimming the room under it; on a phone or tablet the rules come up in
 * the bottom sheet. Either way the card follows the game the host picks, Escape and the close
 * button hand the focus back to the button, and a tap outside closes it.
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

/** The card's widest: two columns, the hero and the key facts beside the five sections (lobby.css lays them out from 640px). */
export const POPOVER_MAX_WIDTH = 760;
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
  /** The How to play button. */
  anchor: ScreenBox;
  /** The highest the card may reach: under the room bar, so the room code always shows (the screen's top edge once the bar has scrolled away). */
  ceiling: number;
  /** Start and Ready: under the player list, or the footer pinned to the foot of a short window. The card leaves them uncovered where it can (placePopover). */
  keepClear: ScreenBox | null;
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
 * Where the desktop card goes. Never over the room bar (the room code) or off the window, and in
 * this order of what matters:
 * 1. The whole card, never cut, wherever the window has the room for it, leaving every game tile
 *    the host could switch to a part to press. It tries under the button, over it, then beside it
 *    (right, then left, as wide as the window leaves there, at most two columns' worth); where no
 *    side of the button holds it, it slides up over the button (all of it, never half), as low as
 *    it fits, from the button's own place or from the window's right or left edge, whichever
 *    leaves the tiles. Of those, one clear of the button wins, then one clear of Start and Ready.
 * 2. Else it scrolls where it has the most room and still leaves the tiles (at least MIN_HEIGHT):
 *    rather a scrolling card than a game the host cannot switch to with it open.
 * 3. Else (no place leaves the tiles) the whole card as in 1, and last, in a window too short for
 *    the whole card anywhere, it scrolls where it has the most room.
 * A scrolling card stops short of Start and Ready (under the player list, or the footer pinned to a
 * short window's foot) wherever that still leaves it MIN_HEIGHT, so they stay in reach; with less
 * room than that there it runs over them.
 */
export function placePopover({ view, anchor, ceiling, keepClear, keepReach, heightAt }: PopoverRoom): PopoverPlacement {
  const floor = view.height - EDGE;
  const midX = (anchor.left + anchor.right) / 2;
  const midY = (anchor.top + anchor.bottom) / 2;
  const width = Math.min(POPOVER_MAX_WIDTH, view.width - 2 * EDGE);
  const whole = heightAt(width);
  // Under or over the button the card hangs from its left edge, or from its right where the window ends first.
  const x = anchor.left + width <= view.width - EDGE ? anchor.left : anchor.right - width >= EDGE ? anchor.right - width : clamp(midX - width / 2, EDGE, view.width - EDGE - width);
  const arrowX = clamp(midX - x, 16, width - 16);

  // The sides of the button: under and over it at the card's widest; beside it as wide as the window leaves, from under the room bar to the window's foot.
  const slots: Slot[] = [
    { side: 'below', x, width, top: anchor.bottom + GAP, bottom: floor },
    { side: 'above', x, width, top: ceiling, bottom: anchor.top - GAP },
  ];
  const rightWidth = Math.min(POPOVER_MAX_WIDTH, view.width - EDGE - anchor.right - GAP);
  const leftWidth = Math.min(POPOVER_MAX_WIDTH, anchor.left - GAP - EDGE);
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
  // Over the button, whole: its top 10px over the button's (or higher, as low as it fits), so it covers the button whole, never half.
  if (whole <= floor - ceiling) {
    const y = Math.max(ceiling, Math.min(floor - whole, anchor.top - GAP));
    for (const left of [x, view.width - EDGE - width, EDGE]) {
      if (left <= anchor.left && left + width >= anchor.right && !places.some((p) => p.side === 'over' && p.x === left)) places.push({ side: 'over', x: left, y, width, height: whole, scrolls: false, arrow: null });
    }
  }

  const clear = (p: PopoverPlacement) => !keepClear || !overlaps(boxOf(p), keepClear);
  const reaches = (p: PopoverPlacement) => keepReach.every((tile) => leavesReach(boxOf(p), tile));
  // Of whole cards: clear of the button before over it, then clear of Start and Ready, then the order tried.
  const best = (list: PopoverPlacement[]) => list.find((p) => p.side !== 'over' && clear(p)) ?? list.find((p) => p.side !== 'over') ?? list.find(clear) ?? list.at(0);
  // Of scrolling cards: the roomiest of those clear of Start and Ready with MIN_HEIGHT, else the roomiest (the first of equals).
  const roomiest = (list: PopoverPlacement[]) => {
    const short = list.filter((p) => clear(p) && p.height >= MIN_HEIGHT);
    return (short.length > 0 ? short : list).reduce<PopoverPlacement | undefined>((top, p) => (!top || p.height > top.height ? p : top), undefined);
  };
  const wholes = places.filter((p) => !p.scrolls);
  const over: PopoverPlacement = { side: 'over', x, y: ceiling, width, height: Math.max(0, floor - ceiling), scrolls: true, arrow: null };
  return best(wholes.filter(reaches)) ?? roomiest(places.filter((p) => reaches(p) && p.height >= MIN_HEIGHT)) ?? best(wholes) ?? roomiest([...places, over]) ?? over;
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
      // The host's tiles other than the picked one: the games a press there switches to, with the card following.
      const others = keepOpenIn?.current ? Array.from(keepOpenIn.current.children).filter((tile) => tile.getAttribute('aria-checked') !== 'true') : [];
      const next = placePopover({
        view: { width: document.documentElement.clientWidth, height: window.innerHeight },
        anchor: anchorBox,
        ceiling: Math.max(EDGE, (bar?.bottom ?? 0) + EDGE),
        // Start and Ready: under the player list in the room's two columns, else in the footer pinned to the window's foot.
        keepClear: document.querySelector('.lobby__actions, .lobby__footer')?.getBoundingClientRect() ?? null,
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
 * game's accent and its text and wash cuts come in as custom properties on the card.
 */
export function RulesCard({ meta, rules, mode }: { meta: GameMeta; rules: GameRules; mode: 'popover' | 'sheet' }) {
  const accent = { '--game-accent': `var(--game-${meta.id})`, '--game-accent-text': `var(--game-${meta.id}-text)`, '--game-accent-soft': `var(--game-${meta.id}-soft)` } as CSSProperties;
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
            <p className="rules__summary">{noOrphan(rules.summary)}</p>
          </div>
        </div>
        <section className="rules__section rules__section--facts" aria-label="Key facts">
          <h4 className="rules__heading">Key facts</h4>
          <div className="rules-facts" data-testid="rules-facts">
            {rules.facts.map((fact) => (
              <div key={fact.label} className="rules-fact" data-testid="rules-fact">
                <span className="rules-fact__label">{fact.label}</span>
                <span className="rules-fact__value">{fact.value}</span>
                <span className="rules-fact__note">{noOrphan(fact.note)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="rules__body">
        {rulesSections(rules).map((s) => (
          <section key={s.key} className="rules__section" data-testid="rules-section" data-section={s.key}>
            <h4 className={`rules__tab rules__tab--${s.tone}`}>{s.heading}</h4>
            <p className="rules__text">{noOrphan(s.text)}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
