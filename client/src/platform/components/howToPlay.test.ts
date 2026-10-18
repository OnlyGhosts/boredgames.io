import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { room } = await import('../../test/fixtures');
const { gameById } = await import('@shared/platform/games');
const { HowToPlay, HowToPlayDialog, POPOVER_MAX_WIDTH, POPOVER_MIN_WIDTH, placePopover } = await import('./HowToPlay');
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
    expect(html).toContain(pokerRules.summary.replace(/ (\S+)$/, ' $1'));
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
    expect(ruleOf(lobbyCss, '.rules-hero .playing-card')).toContain('--card-w: 44px');
    // The card carries the game's accent and its cuts for the hero and the facts.
    expect(tagWith(html, 'how-to-play-card')).toContain('--game-accent-text:var(--game-poker-text)');
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

  it('holds the whole card where the window has room: beside the host’s button, under a guest’s, sliding over the button as a last resort', () => {
    // The card's height at a width, as the lobby measures it: two columns from 640px (567px tall at the widest, taller the
    // narrower), one column under that (840px).
    const heightAt = (width: number) => (width >= 640 ? Math.round(567 + (POPOVER_MAX_WIDTH - width) * 1.1) : 840);
    // The lobby on a 1440x900 window: the room bar ends at 90 (the card keeps 16px under it), the host's button at the right end
    // of the players' column under the tiles, Start and Ready under the player list; Scribble picked, the other four tiles over
    // the button (The Spy Game and Quip Game, then Blackjack and Poker).
    const host1440 = { view: { width: 1440, height: 900 }, anchor: box(628, 358, 134, 44), ceiling: 106, keepClear: box(160, 540, 602, 110), keepReach: [box(363, 106, 195, 116), box(567, 106, 195, 116), box(160, 230, 297, 116), box(465, 230, 297, 116)], heightAt };
    // Neither under the button (472px to the window's foot) nor over it (242px to the room bar) holds the card; beside it, over
    // the settings, it does: as wide as the window leaves (652px, still two columns), from under the room bar, the arrow at the button.
    expect(placePopover(host1440)).toEqual({ side: 'right', x: 772, y: 106, width: 652, height: 686, scrolls: false, arrow: 274 });
    // A guest's button sits high in its one column (no tiles to switch): under it holds the card, at its widest.
    const guest1440 = { view: { width: 1440, height: 900 }, anchor: box(484, 157, 134, 44), ceiling: 106, keepClear: box(360, 361, 720, 139), keepReach: [], heightAt };
    expect(placePopover(guest1440)).toEqual({ side: 'below', x: 484, y: 211, width: 760, height: 567, scrolls: false, arrow: 67 });
    // 1920x1080, the host: under the button holds it too, but over Start; beside it holds it and leaves Start in reach, so beside wins.
    const host1920 = { view: { width: 1920, height: 1080 }, anchor: box(868, 358, 134, 44), ceiling: 106, keepClear: box(400, 540, 602, 110), keepReach: [box(603, 106, 195, 116), box(807, 106, 195, 116), box(400, 230, 297, 116), box(705, 230, 297, 116)], heightAt };
    expect(placePopover(host1920)).toEqual({ side: 'right', x: 1012, y: 106, width: 760, height: 567, scrolls: false, arrow: 274 });
    // 1024x768, a guest: 26px short under the button. Over it rather than scroll, and over all of it (its top 10px above the
    // button's), never cutting it in half.
    const guest1024 = { view: { width: 1024, height: 768 }, anchor: box(276, 157, 134, 44), ceiling: 106, keepClear: box(152, 361, 720, 139), keepReach: [], heightAt };
    expect(placePopover(guest1024)).toEqual({ side: 'over', x: 16, y: 147, width: 760, height: 567, scrolls: false, arrow: null });
    // Over the button when that is where the room is (a tall window, the button low on it), the arrow at the button's middle.
    expect(placePopover({ view: { width: 1440, height: 1200 }, anchor: box(628, 1000, 134, 44), ceiling: 106, keepClear: null, keepReach: [], heightAt })).toEqual({ side: 'above', x: 628, y: 423, width: 760, height: 567, scrolls: false, arrow: 67 });
    // A button near the window's right edge: the card hangs from its right edge.
    expect(placePopover({ view: { width: 1440, height: 900 }, anchor: box(1300, 120, 120, 44), ceiling: 106, keepClear: null, keepReach: [], heightAt })).toEqual({ side: 'below', x: 660, y: 174, width: 760, height: 567, scrolls: false, arrow: 700 });
    // Once the room bar has scrolled away the card may reach higher: beside the button, centred on it.
    expect(placePopover({ ...host1440, ceiling: 16 })).toEqual({ side: 'right', x: 772, y: 37, width: 652, height: 686, scrolls: false, arrow: 343 });
  });

  it('leaves every game the host could switch to a part to press: sliding to the window’s edge, or scrolling beside the button', () => {
    const heightAt = (width: number) => (width >= 640 ? Math.round(567 + (POPOVER_MAX_WIDTH - width) * 1.1) : 840);
    // 1366x768, the host, Scribble picked: no side of the button holds the whole card (beside it one column, too tall for the
    // 646px there). From the button's own place the card would hide Poker whole (and the host could not switch to it with the
    // card open); slid to the window's right edge, over the settings, it leaves Quip Game 60px and Poker 162px at their left.
    const tiles1366 = [box(326, 106, 195, 116), box(530, 106, 195, 116), box(123, 230, 297, 116), box(428, 230, 297, 116)];
    const host1366 = { view: { width: 1366, height: 768 }, anchor: box(591, 358, 134, 44), ceiling: 106, keepClear: box(123, 540, 602, 110), keepReach: tiles1366, heightAt };
    expect(placePopover(host1366)).toEqual({ side: 'over', x: 590, y: 185, width: 760, height: 567, scrolls: false, arrow: null });
    // Without tiles to leave (a guest's button in the same place) it stays over its button, centred on it.
    expect(placePopover({ ...host1366, keepReach: [] })).toEqual({ side: 'over', x: 278, y: 185, width: 760, height: 567, scrolls: false, arrow: null });
    // 1280x720, Scribble picked (its card 524px tall at its widest): slid right, the card leaves Quip Game 74px over it and
    // Poker 119px at its left.
    const scribbleAt = (width: number) => (width >= 640 ? Math.round(524 + (POPOVER_MAX_WIDTH - width) * 1.1) : 840);
    const host1280 = { view: { width: 1280, height: 720 }, anchor: box(548, 358, 134, 44), ceiling: 106, keepClear: box(80, 540, 602, 110), keepReach: [box(283, 106, 195, 116), box(487, 106, 195, 116), box(80, 230, 297, 116), box(385, 230, 297, 116)], heightAt: scribbleAt };
    expect(placePopover(host1280)).toEqual({ side: 'over', x: 504, y: 180, width: 760, height: 524, scrolls: false, arrow: null });
    // Quip Game picked (567px): its own tile is no game to switch to, so the card goes higher, still clear of the others.
    const quipPicked = [box(80, 106, 195, 116), box(283, 106, 195, 116), box(80, 230, 297, 116), box(385, 230, 297, 116)];
    expect(placePopover({ ...host1280, keepReach: quipPicked, heightAt })).toEqual({ side: 'over', x: 504, y: 137, width: 760, height: 567, scrolls: false, arrow: null });
    // 1024x768, Scribble picked: no whole card leaves Poker a part to press, wherever it slides. Rather a scrolling card than a
    // game the host cannot switch to: beside the button, one column, from under the room bar to the foot, clear of every tile,
    // of the button and of Start.
    const tiles1024 = [box(206, 106, 166, 116), box(381, 106, 166, 116), box(32, 230, 253, 116), box(293, 230, 253, 116)];
    const host1024 = { view: { width: 1024, height: 768 }, anchor: box(413, 358, 134, 44), ceiling: 106, keepClear: box(32, 540, 515, 110), keepReach: tiles1024, heightAt };
    expect(placePopover(host1024)).toEqual({ side: 'right', x: 557, y: 106, width: 451, height: 646, scrolls: true, arrow: 274 });
    // Poker picked (its tile no longer one to switch to): the whole card over the button leaves Scribble and Blackjack 68px at
    // their left, The Spy Game and Quip Game 79px over it.
    const pokerPicked = [box(32, 106, 166, 116), box(206, 106, 166, 116), box(381, 106, 166, 116), box(32, 230, 253, 116)];
    expect(placePopover({ ...host1024, keepReach: pokerPicked })).toEqual({ side: 'over', x: 100, y: 185, width: 760, height: 567, scrolls: false, arrow: null });
    // A window that holds the whole card nowhere: it scrolls where it has the most room and leaves the tiles, beside the button.
    const host600 = { view: { width: 1280, height: 600 }, anchor: box(548, 358, 134, 44), ceiling: 106, keepClear: box(80, 540, 602, 110), keepReach: host1280.keepReach, heightAt };
    expect(placePopover(host600)).toEqual({ side: 'right', x: 692, y: 106, width: 572, height: 478, scrolls: true, arrow: 274 });
    // And where nothing leaves the tiles (a made-up room strewn with tiles too small to keep a part of), the whole card still shows.
    const strewn: ReturnType<typeof box>[] = [];
    for (let x = 0; x < 1440; x += 50) for (let y = 0; y < 900; y += 50) strewn.push(box(x, y, 40, 40));
    const room1440 = { view: { width: 1440, height: 900 }, anchor: box(628, 358, 134, 44), ceiling: 106, keepClear: null, keepReach: strewn, heightAt };
    expect(placePopover(room1440)).toEqual(placePopover({ ...room1440, keepReach: [] }));
    expect(placePopover(room1440).scrolls).toBe(false);
  });

  it('stops a scrolling card short of Start and Ready when that leaves it 200px, under the player list or over a pinned footer', () => {
    const heightAt = (width: number) => (width >= 640 ? Math.round(567 + (POPOVER_MAX_WIDTH - width) * 1.1) : 840);
    // A guest on a 1280x600 window: beside the button the card would run 478px down over Ready; it ends 16px over Ready instead,
    // 239px tall, still level with the button.
    const guest600 = { view: { width: 1280, height: 600 }, anchor: box(404, 157, 134, 44), ceiling: 106, keepClear: box(280, 361, 720, 139), keepReach: [], heightAt };
    expect(placePopover(guest600)).toEqual({ side: 'right', x: 548, y: 106, width: 716, height: 239, scrolls: true, arrow: 73 });
    // A desktop window 500px tall takes the phone's layout: Start and Ready in the footer pinned to its foot (385 down). The host,
    // scrolled to the button (the room bar gone): the card scrolls beside it from the window's top to 16px over the footer.
    const short = { view: { width: 1280, height: 500 }, anchor: box(548, 228, 134, 44), ceiling: 16, keepClear: box(0, 385, 1280, 115), keepReach: [box(283, -24, 195, 116), box(487, -24, 195, 116), box(80, 100, 297, 116), box(385, 100, 297, 116)], heightAt };
    expect(placePopover(short)).toEqual({ side: 'right', x: 692, y: 16, width: 572, height: 353, scrolls: true, arrow: 234 });
    // A guest there, the room bar showing: 162px between it and the footer is too little, so the card runs down over the footer.
    const shortGuest = { view: { width: 1280, height: 500 }, anchor: box(404, 229, 134, 44), ceiling: 178, keepClear: box(0, 356, 1280, 144), keepReach: [], heightAt };
    expect(placePopover(shortGuest)).toEqual({ side: 'right', x: 548, y: 178, width: 716, height: 306, scrolls: true, arrow: 73 });
  });

  it('never runs off the window or over the room bar, and shows the whole card whenever the window under the bar can hold it', () => {
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1280, 600], [1024, 600], [2560, 1440]]) {
      for (const cardHeight of [420, 567, 700, 950]) {
        for (const [left, top] of [[32, 120], [300, 160], [width / 2 - 67, 358], [width - 200, 358], [80, 520]]) {
          const widths = new Set<number>();
          const heightAt = (w: number) => {
            widths.add(w);
            return w >= 640 ? cardHeight : Math.round(cardHeight * 1.5);
          };
          const ceiling = 106;
          const p = placePopover({ view: { width, height }, anchor: box(left, top, 134, 44), ceiling, keepClear: null, keepReach: [], heightAt });
          const at = `${width}x${height}, a ${cardHeight}px card, the button at ${left},${top}`;
          expect(p.x, at).toBeGreaterThanOrEqual(16);
          expect(p.x + p.width, at).toBeLessThanOrEqual(width - 16);
          expect(p.y, at).toBeGreaterThanOrEqual(ceiling);
          expect(p.y + p.height, at).toBeLessThanOrEqual(height - 16);
          expect(p.width, at).toBeGreaterThanOrEqual(POPOVER_MIN_WIDTH);
          expect(p.width, at).toBeLessThanOrEqual(POPOVER_MAX_WIDTH);
          // Whole wherever the window under the room bar holds the card at its widest.
          if (cardHeight <= height - 16 - ceiling) expect(p.scrolls, at).toBe(false);
          if (!p.scrolls) expect(p.height, at).toBe(heightAt(p.width));
          // Clear of the button unless it slid over it, and then without an arrow.
          const coversButton = p.x < left + 134 && left < p.x + p.width && p.y < top + 44 && top < p.y + p.height;
          expect(coversButton, at).toBe(p.side === 'over');
          expect(p.arrow === null, at).toBe(p.side === 'over');
          // Measured at three widths at most: its widest, and the room on each side of the button.
          expect(widths.size, at).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('in the host’s room, at every desktop size and card height and with any game picked, leaves each other game’s tile a part to press', () => {
    for (const [width, height] of [[1024, 768], [1024, 640], [1280, 720], [1280, 800], [1366, 768], [1440, 700], [1440, 900], [1600, 900], [1920, 1080], [1280, 600]]) {
      // The room as the stylesheet lays it out: the content at most 1120px wide, centred; the players' column 515px wide at
      // 1024 and 602px from 1280; three tiles over two under them, the How to play button at the column's right end under the
      // tiles, Start under the player list.
      const inner = Math.min(1120, width - 64);
      const left = (width - inner) / 2;
      const col = width >= 1280 ? 602 : 515;
      const third = (col - 16) / 3;
      const half = (col - 8) / 2;
      const tiles = [0, 1, 2].map((i) => box(left + i * (third + 8), 106, third, 116)).concat([0, 1].map((i) => box(left + i * (half + 8), 230, half, 116)));
      for (const cardHeight of [524, 567, 610]) {
        const heightAt = (w: number) => (w >= 640 ? Math.round(cardHeight + (POPOVER_MAX_WIDTH - w) * 1.2) : Math.round(cardHeight * 1.6));
        for (let picked = 0; picked < tiles.length; picked++) {
          const others = tiles.filter((_, i) => i !== picked);
          const p = placePopover({ view: { width, height }, anchor: box(left + col - 134, 358, 134, 44), ceiling: 106, keepClear: box(left, 540, col, 110), keepReach: others, heightAt });
          const card = { left: p.x, top: p.y, right: p.x + p.width, bottom: p.y + p.height };
          for (const t of others) {
            const covered = card.left < t.right && t.left < card.right && card.top < t.bottom && t.top < card.bottom;
            const across = Math.max(card.left - t.left, t.right - card.right);
            const down = Math.max(card.top - t.top, t.bottom - card.bottom);
            expect(!covered || across >= 44 || down >= 44, `${width}x${height}, a ${cardHeight}px card, tile ${picked} picked: a tile at ${t.left},${t.top} keeps a part to press`).toBe(true);
          }
          expect(p.y, `${width}x${height}: under the room bar`).toBeGreaterThanOrEqual(106);
          expect(p.y + p.height, `${width}x${height}: inside the window`).toBeLessThanOrEqual(height - 16);
          // Where the window has the room, a scrolling card has at least 200px.
          if (p.scrolls) expect(p.height, `${width}x${height}: a scrolling card keeps 200px`).toBeGreaterThanOrEqual(200);
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
    // Two columns from 640px wide: the hero and the facts beside the sections, the facts' values a step down to keep to their
    // narrower tiles; the sheet is no such container, so it keeps one column.
    expect(ruleOf(lobbyCss, '.how-to-play__popover')).toContain('container: how-to-play / inline-size');
    const wide = lobbyCss.slice(lobbyCss.indexOf('@container how-to-play (min-width: 640px) {'));
    expect(wide).toMatch(/^@container how-to-play \(min-width: 640px\) \{\s*\.how-to-play__popover \.rules \{[^}]*display: grid;[^}]*grid-template-columns: 324px minmax\(0, 1fr\)/);
    expect(wide.slice(0, wide.indexOf('\n}\n'))).toMatch(/\.how-to-play__popover \.rules-fact__value \{\s*font-size: 1\.25rem;/);
    expect(POPOVER_MIN_WIDTH).toBeLessThan(640);
    expect(POPOVER_MAX_WIDTH).toBeGreaterThan(640);
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
