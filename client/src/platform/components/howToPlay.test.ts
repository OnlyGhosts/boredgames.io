import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { room } = await import('../../test/fixtures');
const { gameById } = await import('@shared/platform/games');
const { HowToPlay, HowToPlayDialog, POPOVER_MAX_WIDTH, POPOVER_MIN_WIDTH, POPOVER_TWO_COLUMNS, POPOVER_WIDTH, placePopover } = await import('./HowToPlay');
const { rulesProse } = await import('../lib/rules');
const { GamePicker } = await import('./GamePicker');
const { templateRules } = await import('../../games/template/rules');
const { pokerRules } = await import('../../games/poker/rules');

const lobbyCss = readFileSync(fileURLToPath(new URL('../styles/lobby.css', import.meta.url)), 'utf8');

/** The body of the first rule for exactly `selector`. */
function ruleOf(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

/** The outer HTML of the first element carrying the test id (its own tag only, for attributes). */
function tagWith(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, testId).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

const noop = () => undefined;

/** A box on the screen from its left, top, width and height. */
const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
const poker = gameById('poker');
const template = gameById('template');

describe('the How to play button', () => {
  it('is a labelled 44px button that says it opens a dialog, closed to start with', () => {
    const html = renderToString(createElement(HowToPlay, { meta: poker, rules: pokerRules }));
    const button = tagWith(html, 'how-to-play');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('type="button"');
    expect(html).toContain('How to play');
    expect(html).not.toContain('role="dialog"');
    expect(ruleOf(lobbyCss, '.how-to-play__btn')).toContain('min-height: 44px');
  });

  it('is beside the game’s line for the host and under who picks for a guest, only once the module is known', () => {
    const module = { meta: template, Screen: () => null, Art: () => null, rules: templateRules };
    const host = renderToString(createElement(GamePicker, { room: room({ gameId: 'template' }), isHost: true, game: module }));
    expect(host).toContain('data-testid="game-picker-meta"');
    expect(host.replace(/<!-- -->/g, '').replace(/<span class="game-picker__count">/g, '').replace(/<\/span>/g, '')).toContain('Click Race · 1+ players');
    // The count keeps to one piece, so a narrow line breaks at the dot.
    expect(host).toContain('<span class="game-picker__count">1+ players</span>');
    expect(host.indexOf('data-testid="how-to-play"')).toBeGreaterThan(host.indexOf('data-testid="game-picker-meta"'));
    const guest = renderToString(createElement(GamePicker, { room: room({ gameId: 'template' }), isHost: false, game: module }));
    expect(guest.indexOf('data-testid="how-to-play"')).toBeGreaterThan(guest.indexOf('data-testid="game-picker-note"'));
    expect(renderToString(createElement(GamePicker, { room: room(), isHost: false, game: null }))).not.toContain('how-to-play');
    // The line and the button share one row even on the narrowest phones: the line wraps its words, the button never drops under the footer.
    expect(ruleOf(lobbyCss, '.game-picker__foot')).not.toContain('flex-wrap');
    expect(ruleOf(lobbyCss, '.game-picker__meta')).toContain('min-width: 0');
    expect(ruleOf(lobbyCss, '.game-picker__foot .how-to-play')).toContain('flex: none');
  });
});

describe('the How to play card', () => {
  it('is a popover dialog on a desktop: named after the game, its close button, the name, summary and five sections', () => {
    const html = renderToString(createElement(HowToPlayDialog, { meta: poker, rules: pokerRules, open: true, mode: 'popover', onClose: noop, id: 'rules-1' }));
    const dialog = tagWith(html, 'how-to-play-popover');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-label="How to play Poker"');
    expect(dialog).toContain('id="rules-1"');
    expect(dialog).not.toContain('aria-modal');
    expect(dialog).toContain('tabindex="-1"');
    expect(tagWith(html, 'how-to-play-close')).toContain('aria-label="Close"');
    expect(tagWith(html, 'how-to-play-card')).toContain('data-mode="popover"');
    expect(html).toContain('data-testid="rules-name"');
    expect(html).toContain('>Poker<');
    // Set as rules prose: "No-limit" never breaks at its hyphen, the last two words keep together.
    expect(html).toContain(rulesProse(pokerRules.summary));
    expect(rulesProse(pokerRules.summary)).toBe('No\u2011limit Texas Hold’em, best five of seven\u00a0cards.');
    expect(html.match(/data-testid="rules-section"/g)).toHaveLength(5);
    expect(html).toContain('How a hand goes');
    // The hero: Poker's two hole cards are the site's own card faces with the badge over them, decorative as a whole.
    const hero = tagWith(html, 'rules-hero');
    expect(hero).toContain('data-kind="cards"');
    expect(hero).toContain('aria-hidden="true"');
    expect(html.match(/data-testid="rules-hero-card"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="ace of hearts"');
    expect(html).toContain('aria-label="ace of diamonds"');
    expect(html).toContain('class="rules-hero__badge">All in<');
    expect(html).not.toContain('data-glyph=');
    // Four key facts under it, each a label, a value and a note.
    expect(html).toContain('>Key facts<');
    expect(tagWith(html, 'rules-facts')).toContain('class="rules-facts"');
    expect(html.match(/data-testid="rules-fact"/g)).toHaveLength(4);
    expect(html).toContain('<span class="rules-fact__label">To act</span><span class="rules-fact__value">25 s</span>');
    // The sections under coloured tab pills: the accent for the hand, then lime, warm, lilac and muted.
    expect([...html.matchAll(/class="rules__tab rules__tab--(\w+)"/g)].map((m) => m[1])).toEqual(['accent', 'lime', 'warm', 'lilac', 'muted']);
    expect(ruleOf(lobbyCss, '.rules__tab--accent')).toContain('color: var(--game-ink)');
    expect(ruleOf(lobbyCss, '.rules-fact__value')).toContain('color: var(--game-accent-text)');
    expect(ruleOf(lobbyCss, '.rules-fact__value')).toContain('white-space: nowrap');
    // A note keeps the line break its game writes into it (Blackjack's goal: "don’t go over" on its own line).
    expect(ruleOf(lobbyCss, '.rules-fact__note')).toContain('white-space: pre-line');
    expect(ruleOf(lobbyCss, '.rules-hero .playing-card')).toContain('--card-w: 44px');
    // The card carries the game's accent and its cuts for the hero and the facts.
    expect(tagWith(html, 'how-to-play-card')).toContain('--game-accent-text:var(--game-poker-text)');
    expect(tagWith(html, 'how-to-play-card')).toContain('--game-accent-edge:var(--game-poker-edge)');
    // No backdrop: the room under it stays usable, and it hangs off the button; the close button sits over the hero, clear of the name.
    expect(html).not.toContain('backdrop');
    expect(ruleOf(lobbyCss, '.how-to-play__popover')).toContain('position: absolute');
    expect(ruleOf(lobbyCss, '.how-to-play__scroll')).toContain('overflow-y: auto');
    expect(ruleOf(lobbyCss, '.how-to-play__popover::before')).toContain('rotate(45deg)');
    expect(ruleOf(lobbyCss, '.how-to-play__popover .rules__name')).toContain('padding-right: 24px');
  });

  it('is the bottom sheet on a phone or tablet, named after the game, with the same card inside', () => {
    const html = renderToString(createElement(HowToPlayDialog, { meta: template, rules: templateRules, open: true, mode: 'sheet', onClose: noop }));
    const sheet = tagWith(html, 'how-to-play-sheet');
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain('aria-label="How to play Click Race"');
    expect(html).toContain('data-testid="how-to-play-sheet-close"');
    expect(html).toContain('data-testid="how-to-play-sheet-backdrop"');
    expect(html).toContain('>How to play<');
    expect(tagWith(html, 'how-to-play-card')).toContain('data-mode="sheet"');
    expect(html).toContain('>Click\u00a0Race<');
    expect(html).toContain('How a round goes');
    expect(html.match(/data-testid="rules-section"/g)).toHaveLength(5);
    expect(html.match(/data-testid="rules-fact"/g)).toHaveLength(4);
    // The template's hero is the fallback: its glyph on the accent plate, no badge.
    expect(tagWith(html, 'rules-hero')).toContain('data-kind="glyph"');
    expect(html).toContain('data-glyph="template"');
    expect(html).not.toContain('rules-hero__badge');
    expect(html).not.toContain('how-to-play-popover');
  });

  /**
   * The card's height at a width, as the lobby measures it: two columns from 640px, 560px tall at POPOVER_WIDTH and shorter the
   * wider it is (520px at a guest's 880px column), one column under 640px (840px).
   */
  const heightAt = (width: number) => (width >= 640 ? Math.round(560 + (POPOVER_WIDTH - width) / 3) : 840);
  /** The host's room as the stylesheet lays it out on a window this wide: the page at most 1120px wide, centred, 32px gutters. */
  const page = (width: number) => {
    const inner = Math.min(1120, width - 64);
    return { left: (width - inner) / 2, right: (width + inner) / 2 };
  };
  /** A guest's one column on a desktop: 880px, centred. */
  const guestColumn = (width: number) => ({ left: (width - 880) / 2, right: (width + 880) / 2 });

  it('holds the whole card where a side of the button has the room, inside the page’s own width, and scrolls it beside the button where none has', () => {
    // The lobby on a 1440x900 window: the room bar from 160 to 1280 ends at 90 (the card keeps 16px under it), the host's
    // button at the right end of the players' column under the tiles, Start and Ready under the player list; Scribble picked,
    // the other four tiles over the button (The Spy Game and Quip Game, then Blackjack and Poker).
    const host1440 = { view: { width: 1440, height: 900 }, bounds: page(1440), anchor: box(628, 358, 134, 44), ceiling: 106, keepClear: box(160, 540, 602, 110), keepReach: [box(363, 106, 195, 116), box(567, 106, 195, 116), box(160, 230, 297, 116), box(465, 230, 297, 116)], heightAt };
    // Neither under the button (472px to the window's foot) nor over it (242px to the room bar) holds the card, and beside it the
    // page leaves 508px (one column, 840px tall, 62px too tall for the window). So it stands beside the button, from under the
    // room bar to the window's foot (778px, 93% of it, the rest scrolling), inside the page (to 1280, never past the room bar's
    // end), clear of the button, of every tile, of the players' statuses and of Start: never the whole card over all of those.
    expect(placePopover(host1440)).toEqual({ side: 'right', x: 772, y: 106, width: 508, height: 778, scrolls: true, arrow: 274 });
    // A guest's button sits high in its one 880px column (no tiles to switch): under it holds the card, from the button's left
    // edge to the column's right edge (756px, two columns), the players' rows left of it still in view.
    const guest1440 = { view: { width: 1440, height: 900 }, bounds: guestColumn(1440), anchor: box(404, 157, 134, 44), ceiling: 106, keepClear: box(280, 361, 880, 139), keepReach: [], heightAt };
    expect(placePopover(guest1440)).toEqual({ side: 'below', x: 404, y: 211, width: 756, height: 561, scrolls: false, arrow: 67 });
    // 1920x1080, the host: beside the button the page leaves 508px, one column, and the window holds all of it there, clear of the
    // tiles and of Start.
    const host1920 = { view: { width: 1920, height: 1080 }, bounds: page(1920), anchor: box(868, 358, 134, 44), ceiling: 106, keepClear: box(400, 540, 602, 110), keepReach: [box(603, 106, 195, 116), box(807, 106, 195, 116), box(400, 230, 297, 116), box(705, 230, 297, 116)], heightAt };
    expect(placePopover(host1920)).toEqual({ side: 'right', x: 1012, y: 106, width: 508, height: 840, scrolls: false, arrow: 274 });
    // 1024x768, a guest with a taller card: 60px short under the button. It hangs there still, showing 90% of itself (541 of
    // 601px) and scrolling the rest, over Ready as the whole card is, from the button's left edge to the column's right; never
    // slid up over its own button, and not a 239px strip beside it stopping short of Ready either.
    const tall = (width: number) => heightAt(width) + 40;
    const guest1024 = { view: { width: 1024, height: 768 }, bounds: guestColumn(1024), anchor: box(196, 157, 134, 44), ceiling: 106, keepClear: box(72, 361, 880, 139), keepReach: [], heightAt: tall };
    expect(placePopover(guest1024)).toEqual({ side: 'below', x: 196, y: 211, width: 756, height: 541, scrolls: true, arrow: 67 });
    // A button too far right for two columns after it: the card spans the column.
    expect(placePopover({ ...guest1440, anchor: box(800, 157, 134, 44) })).toEqual({ side: 'below', x: 280, y: 211, width: 880, height: 520, scrolls: false, arrow: 587 });
    // Over the button when that is where the room is (a tall window, the button low on it), the arrow at the button's middle.
    expect(placePopover({ view: { width: 1440, height: 1200 }, bounds: page(1440), anchor: box(628, 1000, 134, 44), ceiling: 106, keepClear: null, keepReach: [], heightAt })).toEqual({ side: 'above', x: 315, y: 430, width: 760, height: 560, scrolls: false, arrow: 380 });
    // A button at the page's right end: the card hangs from its right edge, which is the page's.
    expect(placePopover({ view: { width: 1440, height: 900 }, bounds: page(1440), anchor: box(1146, 120, 134, 44), ceiling: 106, keepClear: null, keepReach: [], heightAt })).toEqual({ side: 'below', x: 520, y: 174, width: 760, height: 560, scrolls: false, arrow: 693 });
    // Once the room bar has scrolled away the card may reach higher: beside the button, whole in one column, from the window's top.
    expect(placePopover({ ...host1440, ceiling: 16 })).toEqual({ side: 'right', x: 772, y: 16, width: 508, height: 840, scrolls: false, arrow: 364 });
  });

  it('stands beside the host’s button on the common laptop windows, scrolling, clear of the button, every tile and Start, never over them whole', () => {
    // 1366x768, the host, Scribble picked: no side of the button holds the whole card (beside it one column, 840px, too tall
    // for the 646px there). Beside the button it shows 77% of itself and scrolls the rest, from under the room bar to the
    // window's foot, inside the page (to 1243), clear of every tile, of the players' statuses and of Start.
    const tiles1366 = [box(326, 106, 195, 116), box(530, 106, 195, 116), box(123, 230, 297, 116), box(428, 230, 297, 116)];
    const host1366 = { view: { width: 1366, height: 768 }, bounds: page(1366), anchor: box(591, 358, 134, 44), ceiling: 106, keepClear: box(123, 540, 602, 110), keepReach: tiles1366, heightAt };
    expect(placePopover(host1366)).toEqual({ side: 'right', x: 735, y: 106, width: 508, height: 646, scrolls: true, arrow: 274 });
    // Without tiles to leave, the same: never the whole card over its own button, the players and Start while a side holds most of it.
    expect(placePopover({ ...host1366, keepReach: [] })).toEqual({ side: 'right', x: 735, y: 106, width: 508, height: 646, scrolls: true, arrow: 274 });
    // 1280x720, Scribble picked (its card 544px tall): beside the button the page leaves 508px, 598px tall, 73% of the card.
    const scribbleAt = (width: number) => heightAt(width) - 16;
    const host1280 = { view: { width: 1280, height: 720 }, bounds: page(1280), anchor: box(548, 358, 134, 44), ceiling: 106, keepClear: box(80, 540, 602, 110), keepReach: [box(283, 106, 195, 116), box(487, 106, 195, 116), box(80, 230, 297, 116), box(385, 230, 297, 116)], heightAt: scribbleAt };
    expect(placePopover(host1280)).toEqual({ side: 'right', x: 692, y: 106, width: 508, height: 598, scrolls: true, arrow: 274 });
    // Whichever game is picked and however tall its card (Quip Game picked, a 560px card; a 610px one): the same place.
    const quipPicked = [box(80, 106, 195, 116), box(283, 106, 195, 116), box(80, 230, 297, 116), box(385, 230, 297, 116)];
    expect(placePopover({ ...host1280, keepReach: quipPicked, heightAt })).toEqual({ side: 'right', x: 692, y: 106, width: 508, height: 598, scrolls: true, arrow: 274 });
    expect(placePopover({ ...host1280, heightAt: (width: number) => heightAt(width) + 50 })).toEqual({ side: 'right', x: 692, y: 106, width: 508, height: 598, scrolls: true, arrow: 274 });
    // 1024x768, Scribble picked: beside the button, scrolling (77% shows), inside the page (to 992), clear of every tile, of the
    // button and of Start. Poker picked (its tile no longer one to switch to) changes nothing: the whole card over the button
    // would cover the button, the statuses and Start.
    const tiles1024 = [box(206, 106, 166, 116), box(381, 106, 166, 116), box(32, 230, 253, 116), box(293, 230, 253, 116)];
    const host1024 = { view: { width: 1024, height: 768 }, bounds: page(1024), anchor: box(413, 358, 134, 44), ceiling: 106, keepClear: box(32, 540, 515, 110), keepReach: tiles1024, heightAt };
    expect(placePopover(host1024)).toEqual({ side: 'right', x: 557, y: 106, width: 435, height: 646, scrolls: true, arrow: 274 });
    const pokerPicked = [box(32, 106, 166, 116), box(206, 106, 166, 116), box(381, 106, 166, 116), box(32, 230, 253, 116)];
    expect(placePopover({ ...host1024, keepReach: pokerPicked })).toEqual({ side: 'right', x: 557, y: 106, width: 435, height: 646, scrolls: true, arrow: 274 });
    // A window that holds the whole card nowhere: it scrolls where it has the most room and leaves the tiles, beside the button.
    const host600 = { view: { width: 1280, height: 600 }, bounds: page(1280), anchor: box(548, 358, 134, 44), ceiling: 106, keepClear: box(80, 540, 602, 110), keepReach: host1280.keepReach, heightAt };
    expect(placePopover(host600)).toEqual({ side: 'right', x: 692, y: 106, width: 508, height: 478, scrolls: true, arrow: 274 });
    // A tall window (1440x1000) with Start low under a long list: beside the button the card shows 88% of itself (878 of 1000px),
    // clear of Start; it never slides over the button to fit whole.
    const tallRoom = { view: { width: 1440, height: 1000 }, bounds: page(1440), anchor: box(628, 358, 134, 44), ceiling: 106, keepClear: box(160, 820, 602, 110), keepReach: [], heightAt: (width: number) => (width >= 640 ? 680 : 1000) };
    expect(placePopover(tallRoom)).toEqual({ side: 'right', x: 772, y: 106, width: 508, height: 878, scrolls: true, arrow: 274 });
    // Where nothing leaves the tiles (a made-up room strewn with tiles too small to keep a part of) the whole card still shows,
    // over the button from the page's right edge, as low as it fits.
    const strewn: ReturnType<typeof box>[] = [];
    for (let x = 0; x < 1440; x += 50) for (let y = 0; y < 900; y += 50) strewn.push(box(x, y, 40, 40));
    const room1440 = { view: { width: 1440, height: 900 }, bounds: page(1440), anchor: box(628, 358, 134, 44), ceiling: 106, keepClear: null, keepReach: strewn, heightAt };
    expect(placePopover(room1440)).toEqual({ side: 'over', x: 520, y: 324, width: 760, height: 560, scrolls: false, arrow: null });
  });

  it('stops a scrolling card short of Start and Ready when that leaves it 200px, unless it shows most of itself under the list; never runs over a pinned footer', () => {
    // A guest on a 1280x600 window: no whole card fits (561px, 478px under the room bar). Under the button the card shows two
    // thirds of itself (373 of 561px), over Ready as the whole card would be: it hangs there rather than stop short of Ready as
    // a 239px strip beside the button.
    const guest600 = { view: { width: 1280, height: 600 }, bounds: guestColumn(1280), anchor: box(324, 157, 134, 44), ceiling: 106, keepClear: box(200, 361, 880, 139), keepReach: [], heightAt };
    expect(placePopover(guest600)).toEqual({ side: 'below', x: 324, y: 211, width: 756, height: 373, scrolls: true, arrow: 67 });
    // With Ready higher (a short list), where no side shows most of the card: the card ends 16px over Ready, 239px tall, level
    // with the button and inside the guest's column, rather than run over Ready.
    expect(placePopover({ ...guest600, heightAt: (width: number) => heightAt(width) + 200 })).toEqual({ side: 'right', x: 468, y: 106, width: 612, height: 239, scrolls: true, arrow: 73 });
    // A desktop window 500px tall takes the phone's layout: Start and Ready in the footer pinned to its foot (385 down). The host,
    // scrolled to the button (the room bar gone): the card scrolls beside it from the window's top to 16px over the footer, never
    // down over the footer (468px there, more than half the card) while it can stop short of it.
    const short = { view: { width: 1280, height: 500 }, bounds: page(1280), anchor: box(548, 228, 134, 44), ceiling: 16, keepClear: box(0, 385, 1280, 115), pinned: true, keepReach: [box(283, -24, 195, 116), box(487, -24, 195, 116), box(80, 100, 297, 116), box(385, 100, 297, 116)], heightAt };
    expect(placePopover(short)).toEqual({ side: 'right', x: 692, y: 16, width: 508, height: 353, scrolls: true, arrow: 234 });
    // The same block under the player list instead (a tall card, Start low): the card may run down over it, showing most of itself.
    expect(placePopover({ ...short, pinned: false })).toEqual({ side: 'right', x: 692, y: 16, width: 508, height: 468, scrolls: true, arrow: 234 });
    // A guest there, the room bar showing: 162px between it and the footer is too little, so the card runs down over the footer.
    const shortGuest = { view: { width: 1280, height: 500 }, bounds: guestColumn(1280), anchor: box(324, 229, 134, 44), ceiling: 178, keepClear: box(0, 356, 1280, 144), pinned: true, keepReach: [], heightAt };
    expect(placePopover(shortGuest)).toEqual({ side: 'right', x: 468, y: 178, width: 612, height: 306, scrolls: true, arrow: 73 });
  });

  it('never runs past the page’s own edges, off the window or over the room bar, and shows the whole card whenever a side of the button holds it', () => {
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1280, 600], [1024, 600], [2560, 1440]]) {
      for (const bounds of [page(width), guestColumn(width)]) {
        for (const cardHeight of [420, 567, 700, 950]) {
          for (const [left, top] of [[bounds.left, 120], [bounds.left + 268, 160], [(bounds.left + bounds.right) / 2 - 67, 358], [bounds.right - 134, 358], [bounds.left + 48, 520]]) {
            const widths = new Set<number>();
            const heightAt = (w: number) => {
              widths.add(w);
              return w >= 640 ? cardHeight : Math.round(cardHeight * 1.5);
            };
            const ceiling = 106;
            const p = placePopover({ view: { width, height }, bounds, anchor: box(left, top, 134, 44), ceiling, keepClear: null, keepReach: [], heightAt });
            const at = `${width}x${height}, the page ${bounds.left} to ${bounds.right}, a ${cardHeight}px card, the button at ${left},${top}`;
            expect(p.x, at).toBeGreaterThanOrEqual(Math.max(16, bounds.left));
            expect(p.x + p.width, at).toBeLessThanOrEqual(Math.min(width - 16, bounds.right));
            expect(p.y, at).toBeGreaterThanOrEqual(ceiling);
            expect(p.y + p.height, at).toBeLessThanOrEqual(height - 16);
            expect(p.width, at).toBeGreaterThanOrEqual(POPOVER_MIN_WIDTH);
            expect(p.width, at).toBeLessThanOrEqual(POPOVER_MAX_WIDTH);
            // Under or over the button: in a column no wider than the card's widest, from the button's left edge to the column's
            // right (the whole column where that is under two columns' worth); over a wider page, POPOVER_WIDTH.
            const fromButton = bounds.right - Math.max(bounds.left, left);
            const column = bounds.right - bounds.left;
            if (p.side === 'below' || p.side === 'above' || p.side === 'over') expect(p.width, at).toBe(column > POPOVER_MAX_WIDTH ? POPOVER_WIDTH : fromButton >= POPOVER_TWO_COLUMNS ? fromButton : column);
            // Whole wherever a side of the button holds the card (under it, over it or beside it, as wide as the page leaves
            // there); where none does, it scrolls on a side rather than slide whole over the button.
            const sideWidth = column > POPOVER_MAX_WIDTH ? POPOVER_WIDTH : fromButton >= POPOVER_TWO_COLUMNS ? fromButton : column;
            const rightWidth = Math.min(POPOVER_MAX_WIDTH, Math.min(width - 16, bounds.right) - (left + 134) - 10);
            const leftWidth = Math.min(POPOVER_MAX_WIDTH, left - 10 - Math.max(16, bounds.left));
            const holds = (w: number, room: number) => w >= POPOVER_MIN_WIDTH && heightAt(w) <= room;
            const aSide = holds(sideWidth, height - 16 - (top + 44 + 10)) || holds(sideWidth, top - 10 - ceiling) || holds(rightWidth, height - 16 - ceiling) || holds(leftWidth, height - 16 - ceiling);
            expect(p.scrolls, at).toBe(!aSide);
            if (!p.scrolls) expect(p.height, at).toBe(heightAt(p.width));
            // Clear of the button unless it slid over it, and then without an arrow.
            const coversButton = p.x < left + 134 && left < p.x + p.width && p.y < top + 44 && top < p.y + p.height;
            expect(coversButton, at).toBe(p.side === 'over');
            expect(p.arrow === null, at).toBe(p.side === 'over');
            // Measured at three widths at most: under or over the button, and the room on each side of it.
            expect(widths.size, at).toBeLessThanOrEqual(3);
          }
        }
      }
    }
  });

  it('in the host’s room, at every desktop size and card height and with any game picked, leaves each other game’s tile a part to press', () => {
    for (const [width, height] of [[1024, 768], [1024, 640], [1280, 720], [1280, 800], [1366, 768], [1366, 650], [1440, 700], [1440, 900], [1600, 900], [1920, 1080], [1280, 600]]) {
      // The room as the stylesheet lays it out: the content at most 1120px wide, centred; the players' column 515px wide at
      // 1024 and 602px from 1280; three tiles over two under them, the How to play button at the column's right end under the
      // tiles, Start under the player list.
      const bounds = page(width);
      const left = bounds.left;
      const col = width >= 1280 ? 602 : 515;
      const third = (col - 16) / 3;
      const half = (col - 8) / 2;
      const tiles = [0, 1, 2].map((i) => box(left + i * (third + 8), 106, third, 116)).concat([0, 1].map((i) => box(left + i * (half + 8), 230, half, 116)));
      for (const cardHeight of [524, 567, 610]) {
        const heightAt = (w: number) => (w >= 640 ? Math.round(cardHeight + (POPOVER_WIDTH - w) * 1.2) : Math.round(cardHeight * 1.6));
        for (let picked = 0; picked < tiles.length; picked++) {
          const others = tiles.filter((_, i) => i !== picked);
          const p = placePopover({ view: { width, height }, bounds, anchor: box(left + col - 134, 358, 134, 44), ceiling: 106, keepClear: box(left, 540, col, 110), keepReach: others, heightAt });
          const card = { left: p.x, top: p.y, right: p.x + p.width, bottom: p.y + p.height };
          for (const t of others) {
            const covered = card.left < t.right && t.left < card.right && card.top < t.bottom && t.top < card.bottom;
            const across = Math.max(card.left - t.left, t.right - card.right);
            const down = Math.max(card.top - t.top, t.bottom - card.bottom);
            expect(!covered || across >= 44 || down >= 44, `${width}x${height}, a ${cardHeight}px card, tile ${picked} picked: a tile at ${t.left},${t.top} keeps a part to press`).toBe(true);
          }
          expect(p.x, `${width}x${height}: inside the page`).toBeGreaterThanOrEqual(bounds.left);
          expect(p.x + p.width, `${width}x${height}: inside the page`).toBeLessThanOrEqual(bounds.right);
          expect(p.y, `${width}x${height}: under the room bar`).toBeGreaterThanOrEqual(106);
          expect(p.y + p.height, `${width}x${height}: inside the window`).toBeLessThanOrEqual(height - 16);
          // Where the window has the room, a scrolling card has at least 200px.
          if (p.scrolls) expect(p.height, `${width}x${height}: a scrolling card keeps 200px`).toBeGreaterThanOrEqual(200);
          // Never over its own button (a side of it always holds a part of the card), and a scrolling card beside it is clear of Start.
          expect(p.side, `${width}x${height}: never over the button`).not.toBe('over');
          const start = { left, top: 540, right: left + col, bottom: 650 };
          if (p.scrolls) expect(card.left < start.right && start.left < card.right && card.top < start.bottom && start.top < card.bottom, `${width}x${height}: a scrolling card is clear of Start`).toBe(false);
        }
      }
    }
  });

  it('scrolls only with a head for its close button and fades at a cut edge, and lays a wide card out in two columns', () => {
    // A card that scrolls gets a head row holding the close button, so the button never sits over the rules under it.
    expect(ruleOf(lobbyCss, '.how-to-play__head')).toContain('position: absolute');
    expect(ruleOf(lobbyCss, '.how-to-play__popover--scrolls .how-to-play__head')).toContain('position: static');
    expect(ruleOf(lobbyCss, '.how-to-play__popover--scrolls .how-to-play__head')).toContain('border-bottom: 1px solid var(--color-border)');
    // Each end with more to read fades into the card, so a line cut at the edge reads as a scroll: a band of the card's surface
    // stuck to that edge inside the scroll box (no mask on the box, which would fade its scrollbar too), the box without padding
    // of its own so the bands reach its edges.
    const scroll = ruleOf(lobbyCss, '.how-to-play__scroll');
    expect(scroll).toContain('overflow-y: auto');
    expect(scroll).toContain('min-height: 0');
    expect(scroll).not.toContain('mask');
    expect(scroll).not.toContain('padding');
    expect(ruleOf(lobbyCss, '.how-to-play__scroll > .rules')).toContain('padding: var(--space-4)');
    const bands = lobbyCss.slice(lobbyCss.indexOf('\n.how-to-play__scroll::before,\n.how-to-play__scroll::after {'));
    expect(ruleOf(bands, '.how-to-play__scroll::after')).toContain('position: sticky');
    expect(ruleOf(bands, '.how-to-play__scroll::after')).toContain('pointer-events: none');
    expect(ruleOf(bands, '.how-to-play__scroll::after')).toContain('opacity: 0');
    const top = ruleOf(lobbyCss, '.how-to-play__scroll::before');
    expect(top).toContain('top: 0');
    expect(top).toContain('height: 32px');
    expect(top).toContain('margin-bottom: -32px');
    expect(top).toContain('background: linear-gradient(var(--color-surface), transparent)');
    const bottom = ruleOf(lobbyCss.slice(lobbyCss.indexOf('\n.how-to-play__scroll::before {')), '.how-to-play__scroll::after');
    expect(bottom).toContain('bottom: 0');
    expect(bottom).toContain('height: 48px');
    expect(bottom).toContain('margin-top: -48px');
    expect(bottom).toContain('background: linear-gradient(transparent, var(--color-surface))');
    expect(lobbyCss).toContain(".how-to-play__scroll[data-fade~='top']::before,\n.how-to-play__scroll[data-fade~='bottom']::after {\n  opacity: 1;\n}");
    // Two columns from 640px wide: the hero across the top, the four facts in one row under it (their values a step down to keep
    // to the narrower tiles), then the sections down two columns the browser balances, each section whole in one of them, the
    // prose a step smaller; the sheet is no such container, so it keeps one column.
    expect(ruleOf(lobbyCss, '.how-to-play__popover')).toContain('container: how-to-play / inline-size');
    const wide = lobbyCss.slice(lobbyCss.indexOf('@container how-to-play (min-width: 640px) {'));
    const block = wide.slice(0, wide.indexOf('\n}\n'));
    expect(block).toMatch(/\.how-to-play__popover \.rules-facts \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(block).toMatch(/\.how-to-play__popover \.rules-fact__value \{\s*font-size: 1\.1875rem;/);
    expect(block).toMatch(/\.how-to-play__popover \.rules__body \{\s*display: block;\s*columns: 2;/);
    expect(block).toMatch(/\.how-to-play__popover \.rules__body > \.rules__section \{\s*break-inside: avoid;/);
    expect(block).toMatch(/\.how-to-play__popover \.rules__text \{\s*font-size: 0\.875rem;/);
    // No side column of a fixed width any more: beside it the sections ran far below the facts.
    expect(block).not.toContain('grid-template-columns: 324px');
    expect(POPOVER_TWO_COLUMNS).toBe(640);
    expect(lobbyCss).toContain(`@container how-to-play (min-width: ${POPOVER_TWO_COLUMNS}px) {`);
    expect(POPOVER_MIN_WIDTH).toBeLessThan(POPOVER_TWO_COLUMNS);
    expect(POPOVER_WIDTH).toBeGreaterThanOrEqual(POPOVER_TWO_COLUMNS);
    expect(POPOVER_MAX_WIDTH).toBeGreaterThan(POPOVER_WIDTH);
    // An arrow on each side it can sit, none when the card slid over its button.
    expect(ruleOf(lobbyCss, '.how-to-play__popover--right::before')).toContain('left: -6px');
    expect(ruleOf(lobbyCss, '.how-to-play__popover--left::before')).toContain('right: -6px');
    expect(ruleOf(lobbyCss, '.how-to-play__popover--over::before')).toContain('display: none');
  });

  it('renders nothing while closed, in either shape', () => {
    for (const mode of ['popover', 'sheet'] as const) {
      expect(renderToString(createElement(HowToPlayDialog, { meta: poker, rules: pokerRules, open: false, mode, onClose: noop }))).toBe('');
    }
  });
});
