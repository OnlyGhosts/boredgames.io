import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { DEALER_STANDS_AT } from '../shared/games/blackjack/cards';
import { SPYGAME_ROUND_MINUTES } from '../shared/games/spygame/protocol';
import { closeResults, createParty, expectConfirmReadsOnce, expectPlayersInReach, expectReadyCount, expectResults, expectRulesReadCleanly, joinByCode, leaveLobby, readyAll, roomTabTitle } from './party';
import { tableBots } from './tableBots';

/**
 * The party stays together across games. Four players (one on a phone) create a Click Race
 * party at /template, ready up and play the race to its end: everyone lands back in the lobby with
 * the results over it, the winner celebrated, nobody thrown out by a stray Enter, a reload still
 * showing them, each closing them their own way; everyone readies up again, and the host switches
 * the party to The Spy Game (the URL follows on every phone, nobody rejoins); one
 * player sits the next game out, the host sets Unhinged, the other three play a one-round Spy
 * Game while the fourth watches, and the party lands back in the lobby. Serial: the tests build
 * on each other.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
/** A 360px phone: the How to play tiles are a size between the two, where a long value once overran. */
const MID = { width: 360, height: 740 };
/** playwright.config's default viewport, restored after a small-screen check. */
const DESKTOP = { width: 1280, height: 800 };
/** The smallest desktop-sized screen, where How to play is a popover with little room under its button. */
const LANDSCAPE_TABLET = { width: 1024, height: 768 };
/** A roomy desktop, where How to play once opened upwards over the room code. */
const WIDE = { width: 1440, height: 900 };
/** A short desktop window: too short for the whole How to play card anywhere. */
const SHORT = { width: 1280, height: 600 };
/** The common laptop and a 720p window: no side of the host's How to play button holds the whole card. */
const LAPTOP = { width: 1366, height: 768 };
const HD = { width: 1280, height: 720 };
/** A desktop window short enough for the phone's layout: Start and Ready in a footer pinned to its foot, How to play still a popover. */
const LETTERBOX = { width: 1280, height: 500 };
/** A tablet held upright: the room's two columns, the settings column at its narrowest. */
const PORTRAIT_TABLET = { width: 768, height: 1024 };
/** A phone on its side: the phone's layout (Start pinned to the foot) over the room's two columns. */
const SIDEWAYS = { width: 844, height: 390 };
/** A real 1366x768 laptop's browser, the window less its tabs and bars. */
const LAPTOP_BROWSER = { width: 1366, height: 650 };
const BIG = { width: 1920, height: 1080 };
/** The laptop windows a host or a guest sees the room at, short to tall. */
const LAPTOP_SIZES = [LANDSCAPE_TABLET, HD, DESKTOP, LAPTOP, LAPTOP_BROWSER, WIDE, BIG];
/** The phones, and one on its side. */
const PHONE_SIZES = [PORTRAIT, MID, SMALL, SIDEWAYS];
const MIN_TARGET = 44;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let pia: Player;
let quinn: Player;
let rae: Player;
let code = '';

async function newPlayer(browser: Browser, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Player> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  const player: Player = { name, context, page, errors };
  players.push(player);
  return player;
}

const guests = (): Player[] => players.filter((p) => p !== host);

async function noHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function expectInsideViewport(page: Page, testId: string, size: { width: number; height: number }): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 0.5);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height + 0.5);
}

/**
 * The open How to play card on a desktop window: inside the window, clear of the room bar (the room code shows), and the
 * whole card (no scrolling inside it) wherever the window has the room. When it must scroll, its close button sits in a
 * head above the rules, never over them, and the cut edge fades.
 */
async function expectRulesCardPlaced(page: Page, size: { width: number; height: number }, whole: boolean): Promise<void> {
  const label = `${size.width}x${size.height}`;
  await expect(page.getByTestId('how-to-play-popover')).toBeVisible();
  await expectInsideViewport(page, 'how-to-play-popover', size);
  const at = await page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const scroll = document.querySelector('.how-to-play__scroll') as HTMLElement;
    const band = getComputedStyle(scroll, '::after');
    // The sections' columns: where each one's last section ends (one key per column, by its left edge).
    const ends: Record<number, number> = {};
    for (const section of document.querySelectorAll('[data-testid="how-to-play-popover"] [data-testid="rules-section"]')) {
      const r = section.getBoundingClientRect();
      ends[Math.round(r.left)] = Math.max(ends[Math.round(r.left)] ?? 0, r.bottom);
    }
    return {
      card: box('[data-testid="how-to-play-popover"]'),
      code: box('[data-testid="room-code"]'),
      bar: box('.lobby__top'),
      close: box('[data-testid="how-to-play-close"]'),
      rules: box('.how-to-play__scroll'),
      scrolls: scroll.scrollHeight > scroll.clientHeight + 1,
      fade: scroll.getAttribute('data-fade'),
      band: { opacity: band.opacity, width: parseFloat(band.width), inside: scroll.clientWidth },
      columns: Object.values(ends),
    };
  });
  const { card, code, bar, close, rules } = at;
  if (!card || !code || !bar || !close || !rules) throw new Error(`${label}: the card, the code or the room bar has no box`);
  expect(card.top, `${label}: the card stays under the room bar`).toBeGreaterThanOrEqual(bar.bottom - 0.5);
  // Inside the page's own width: never past the room bar's ends (it once ran 144px past them at 1440).
  expect(card.left, `${label}: the card starts inside the page`).toBeGreaterThanOrEqual(bar.left - 0.5);
  expect(card.right, `${label}: the card ends inside the page`).toBeLessThanOrEqual(bar.right + 0.5);
  // Two columns of sections end close together (a side column once ran 260px past the facts beside it).
  if (at.columns.length === 2) expect(Math.abs(at.columns[0] - at.columns[1]), `${label}: the columns are balanced`).toBeLessThanOrEqual(96);
  const overCode = card.left < code.right && code.left < card.right && card.top < code.bottom && code.top < card.bottom;
  expect(overCode, `${label}: the card leaves the room code showing`).toBe(false);
  if (whole) {
    expect(at.scrolls, `${label}: the whole card shows, nothing to scroll`).toBe(false);
    await expect(page.getByTestId('how-to-play-popover')).toHaveAttribute('data-scrolls', 'false');
    const last = await page.getByTestId('rules-section').last().boundingBox();
    expect((last?.y ?? 0) + (last?.height ?? 0), `${label}: the last section shows inside the card`).toBeLessThanOrEqual(card.bottom + 0.5);
  } else if (at.scrolls) {
    expect(close.bottom, `${label}: the close button sits over the rules' box, never over the rules`).toBeLessThanOrEqual(rules.top + 0.5);
    expect(at.fade ?? '', `${label}: the cut edge fades`).toContain('bottom');
    // The fade is a band of the card's surface inside the scroll box, beside its scrollbar, never over it.
    expect(at.band.opacity, `${label}: the bottom band shows`).toBe('1');
    expect(at.band.width, `${label}: the band keeps inside the box, clear of its scrollbar`).toBeLessThanOrEqual(at.band.inside + 0.5);
  }
}

/**
 * With the host's card open: a point on each game tile that a press reaches (the card is not over it), nearest the tile's
 * middle, or null where the card hides the tile whole.
 */
async function tilePoints(page: Page): Promise<Record<string, { x: number; y: number } | null>> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number } | null> = {};
    for (const tile of document.querySelectorAll<HTMLElement>('[data-testid="game-picker"] [data-testid="game-tile"]')) {
      const r = tile.getBoundingClientRect();
      let best: { x: number; y: number; d: number } | null = null;
      for (let i = 1; i < 20; i++) {
        for (let j = 1; j < 20; j++) {
          const x = r.left + (r.width * i) / 20;
          const y = r.top + (r.height * j) / 20;
          const el = document.elementFromPoint(x, y);
          if (!el || !tile.contains(el)) continue;
          const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      out[tile.getAttribute('data-game') ?? ''] = best && { x: best.x, y: best.y };
    }
    return out;
  });
}

/** Each content card's label, 18+ tag and tick sit inside its padding (clear of its border), and no blurb leaves a word alone on a line. */
async function expectContentCardsFit(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    for (const card of document.querySelectorAll<HTMLElement>('.content-mode')) {
      const name = card.getAttribute('data-testid') ?? '';
      const c = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      const px = (v: string) => parseFloat(v) || 0;
      const left = c.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
      const right = c.right - px(cs.borderRightWidth) - px(cs.paddingRight);
      for (const sel of ['.content-mode__label', '.content-mode__age', '.content-mode__check']) {
        const b = card.querySelector(sel)?.getBoundingClientRect();
        if (b && (b.left < left - 0.5 || b.right > right + 0.5)) out.push(`${name} ${sel} runs past the card's edge`);
      }
      // The blurb's lines, word by word (a no-break space keeps two words as one piece, so count the words in it).
      const text = card.querySelector('.content-mode__blurb')?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) continue;
      const lines = new Map<number, number>();
      for (const m of (text.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, m.index ?? 0);
        range.setEnd(text, (m.index ?? 0) + m[0].length);
        const top = Math.round(range.getClientRects()[0]?.top ?? 0);
        const line = [...lines.keys()].find((t) => Math.abs(t - top) < 3) ?? top;
        lines.set(line, (lines.get(line) ?? 0) + m[0].split('\u00a0').length);
      }
      if ([...lines.values()].some((words) => words < 2)) out.push(`${name}'s blurb leaves a word alone on a line`);
    }
    return out;
  });
  expect(problems, label).toEqual([]);
}

/** The session the client keeps for its seat: the proof a page is still in the room. */
async function seatCode(page: Page): Promise<string | null> {
  return page.evaluate(() => (JSON.parse(sessionStorage.getItem('boredgames.session') ?? 'null') as { code?: string } | null)?.code ?? null);
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn');
  rae = await newPlayer(browser, 'Rae');
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Click Race party, three friends join, and the lobby shows the game picker', async () => {
  code = await createParty(host.page, host.name, 'template');
  for (const g of guests()) await joinByCode(g.page, g.name, code);
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(4);

  // The host picks from tappable cards (the hidden template game is offered only because it is the current one).
  const picker = host.page.getByTestId('game-picker');
  await expect(picker).toHaveAttribute('data-game', 'template');
  await expect(picker.locator('[data-testid="game-tile"][data-game="template"]')).toHaveAttribute('aria-checked', 'true');
  await expect(picker.locator('[data-testid="game-tile"][data-game="spygame"]')).toHaveAttribute('aria-checked', 'false');
  await expect(picker.getByTestId('game-tile')).toHaveCount(6);
  // Everyone else sees the current game and who decides.
  await expect(pia.page.getByTestId('game-picker-note')).toHaveText(`${host.name} picks the game`);
  await expect(pia.page.getByTestId('game-picker').getByTestId('game-tile')).toHaveCount(1);
  await expect(pia.page.locator('button[data-testid="game-tile"]')).toHaveCount(0);

  // Click Race never reads the content mode, so nobody is offered one for it.
  for (const p of players) await expect(p.page.getByTestId('settings-contentMode')).toHaveCount(0);
  // Only the host has settings; the others just sit in the room with their ready buttons.
  await expect(host.page.getByTestId('settings-panel')).toBeVisible();
  for (const g of guests()) await expect(g.page.getByTestId('settings-panel')).toHaveCount(0);

  // The phone lobby: the logo bare, then the room code card under it, then the picker; ready controls fit the screen with 44px targets.
  await expect(pia.page.locator('.lobby__top > section')).toHaveAttribute('data-testid', 'room-bar');
  const phoneLogo = await pia.page.getByTestId('site-header').boundingBox();
  const phoneBar = await pia.page.getByTestId('room-bar').boundingBox();
  expect((phoneLogo?.y ?? 0) + (phoneLogo?.height ?? 0), 'the logo stacks over the room code').toBeLessThanOrEqual((phoneBar?.y ?? 0) + 0.5);
  const phoneSurfaces = await pia.page.evaluate(() => {
    const bg = (sel: string) => getComputedStyle(document.querySelector(sel) as Element).backgroundColor;
    return { top: bg('.lobby__top'), card: bg('[data-testid="room-bar"]') };
  });
  expect(phoneSurfaces.top, 'nothing drawn round the logo').toBe('rgba(0, 0, 0, 0)');
  expect(phoneSurfaces.card, 'the code on its card').not.toBe('rgba(0, 0, 0, 0)');
  await noHorizontalOverflow(pia.page, PORTRAIT.width);
  for (const id of ['game-tile', 'ready-toggle', 'sitout-toggle', 'edit-profile', 'copy-code', 'share-invite', 'leave-room', 'settings-menu']) {
    const box = await pia.page.getByTestId(id).first().boundingBox();
    expect(box?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${id} fits the phone width`).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
  }
  // Sit this one out and Change my look are buttons side by side, under I'm ready.
  const ready = await pia.page.getByTestId('ready-toggle').boundingBox();
  const sitOut = await pia.page.getByTestId('sitout-toggle').boundingBox();
  const look = await pia.page.getByTestId('edit-profile').boundingBox();
  expect(Math.abs((sitOut?.y ?? 0) - (look?.y ?? 1)), 'one row').toBeLessThanOrEqual(0.5);
  expect((sitOut?.x ?? 0) + (sitOut?.width ?? 0)).toBeLessThanOrEqual(look?.x ?? 0);
  expect(sitOut?.y ?? 0).toBeGreaterThan((ready?.y ?? 0) + (ready?.height ?? 0) - 0.5);
  await expect(pia.page.getByTestId('sitout-toggle')).toHaveClass(/btn--secondary/);
  await expect(pia.page.getByTestId('edit-profile')).toHaveClass(/btn--secondary/);
  // Change my look opens the editor in a sheet; Save closes it.
  await pia.page.getByTestId('edit-profile').click();
  await expect(pia.page.getByTestId('profile-sheet').getByTestId('profile-editor')).toBeVisible();
  await pia.page.getByTestId('save-profile').click();
  await expect(pia.page.getByTestId('profile-sheet')).toHaveCount(0);

  // On a phone the room's logo is centred at the top, the settings gear still on its "o".
  const header = pia.page.getByTestId('site-header');
  const mark = await header.getByTestId('wordmark').boundingBox();
  expect(Math.abs((mark?.x ?? 0) + (mark?.width ?? 0) / 2 - PORTRAIT.width / 2), 'the logo is centred').toBeLessThanOrEqual(1.5);
  const gear = await header.locator('.wordmark__gear').boundingBox();
  const gearButton = await header.getByTestId('settings-menu').boundingBox();
  expect(Math.abs((gear?.x ?? 0) + (gear?.width ?? 0) / 2 - ((gearButton?.x ?? 0) + (gearButton?.width ?? 0) / 2))).toBeLessThanOrEqual(1.5);
  await header.getByTestId('settings-menu').click();
  await expectInsideViewport(pia.page, 'settings-popover', PORTRAIT);
  await pia.page.keyboard.press('Escape');
  // The desktop: one header bar. The logo at the left of its surface, the code and its buttons on the same line inside it.
  const bar = await host.page.locator('.lobby__top').boundingBox();
  const desk = await host.page.getByTestId('site-header').getByTestId('wordmark').boundingBox();
  expect(desk?.x ?? 999).toBeLessThan(100);
  expect(desk?.x ?? 0, 'the logo sits inside the bar, at its left').toBeGreaterThan(bar?.x ?? 0);
  expect(desk?.x ?? 0).toBeLessThan((bar?.x ?? 0) + 40);
  const deskBar = await host.page.getByTestId('room-bar').boundingBox();
  const centre = (box: typeof desk) => (box?.y ?? 0) + (box?.height ?? 0) / 2;
  expect(Math.abs(centre(desk) - centre(deskBar)), 'the logo sits beside the code, centred on it').toBeLessThanOrEqual(2);
  expect(deskBar?.x ?? 0, 'the code starts after the logo').toBeGreaterThan((desk?.x ?? 0) + (desk?.width ?? 0));
  expect((deskBar?.x ?? 0) + (deskBar?.width ?? 0), 'and ends inside the bar').toBeLessThanOrEqual((bar?.x ?? 0) + (bar?.width ?? 0));
  expect(bar?.height ?? 0, 'one slim bar').toBeLessThanOrEqual(72);
  // The bar is the one surface; the code section is a bare part of it, not a card beside the logo.
  const surfaces = await host.page.evaluate(() => {
    const style = (sel: string) => getComputedStyle(document.querySelector(sel) as Element);
    return {
      bar: style('.lobby__top').backgroundColor,
      barBorder: style('.lobby__top').borderTopWidth,
      section: style('[data-testid="room-bar"]').backgroundColor,
      sectionBorder: style('[data-testid="room-bar"]').borderTopWidth,
    };
  });
  expect(surfaces.bar).not.toBe('rgba(0, 0, 0, 0)');
  expect(surfaces.barBorder).toBe('1px');
  expect(surfaces.section).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces.sectionBorder).toBe('0px');
  // The tiles, Copy, Share, Leave and the gear all centre on the bar's line; the buttons and the gear stay 44px targets.
  for (const id of ['room-code', 'copy-code', 'share-invite', 'leave-room', 'settings-menu']) {
    const box = await host.page.getByTestId(id).boundingBox();
    expect(Math.abs(centre(box) - centre(bar)), `${id} centred on the bar`).toBeLessThanOrEqual(1.5);
    if (id !== 'room-code') expect(box?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  // The gear's menu drops out from under the bar, clear of its bottom edge, never pasted over it.
  await host.page.getByTestId('settings-menu').click();
  const deskPopover = await host.page.getByTestId('settings-popover').boundingBox();
  expect(deskPopover?.y ?? 0, 'the popover starts below the bar').toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0) + 4);
  await expectInsideViewport(host.page, 'settings-popover', host.page.viewportSize() ?? PORTRAIT);
  // The gear is for the site's settings alone: the theme and the sound switch, no room buttons.
  const popover = host.page.getByTestId('settings-popover');
  await expect(popover.getByTestId('theme-dark')).toBeVisible();
  await expect(popover.getByTestId('sound-toggle')).toBeVisible();
  await expect(popover.locator('button')).toHaveCount(3);
  await expect(popover.getByTestId('leave-room')).toHaveCount(0);
  await expect(popover.getByTestId('copy-link')).toHaveCount(0);
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('settings-popover')).toHaveCount(0);

  // Leave is the bar's last button and asks first; Stay keeps the host in the room.
  const leave = await host.page.getByTestId('leave-room').boundingBox();
  const shareBtn = await host.page.getByTestId('share-invite').boundingBox();
  expect(leave?.x ?? 0, 'Leave sits after Share').toBeGreaterThanOrEqual((shareBtn?.x ?? 0) + (shareBtn?.width ?? 0));
  expect((leave?.x ?? 0) + (leave?.width ?? 0), 'at the bar’s right end').toBeLessThanOrEqual((bar?.x ?? 0) + (bar?.width ?? 0));
  await host.page.getByTestId('leave-room').click();
  const confirm = host.page.getByTestId('lobby-leave-confirm');
  await expect(confirm).toContainText('Leave the room?');
  await expect(confirm).toContainText('You’d need the code to come back in.');
  // It says so once: the question heads it (no title row over it saying the same), the button is Leave.
  await expectConfirmReadsOnce(host.page, 'Leave the room?', host.page.getByTestId('lobby-leave-yes'), 'Leave');
  await host.page.getByTestId('lobby-leave-no').click();
  await expect(confirm).toHaveCount(0);
  await expect(host.page.getByTestId('room-code')).toHaveText(code);
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(4);

  // The bar keeps one rhythm for the host and a guest: the code centred between the logo and the buttons, clear room either
  // side (a guest's once sat 7px from Copy and 14px from the gear).
  for (const size of [LANDSCAPE_TABLET, DESKTOP, WIDE]) {
    for (const p of [host, quinn]) {
      await p.page.setViewportSize(size);
      const gaps = await p.page.evaluate(() => {
        const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { before: r('room-code').left - document.querySelector('.lobby__top .site-header')!.getBoundingClientRect().right, after: r('copy-code').left - r('room-code').right };
      });
      const label = `${p.name} ${size.width}`;
      expect(gaps.before, `${label}: room between the logo and the code`).toBeGreaterThanOrEqual(48);
      expect(gaps.after, `${label}: room between the code and Copy`).toBeGreaterThanOrEqual(48);
      expect(Math.abs(gaps.before - gaps.after), `${label}: the code centred between them`).toBeLessThanOrEqual(12);
    }
  }
  for (const p of [host, quinn]) await p.page.setViewportSize(DESKTOP);
});

const ROOM_SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  SIDEWAYS,
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

test('a phone pins Start and Ready to the bottom of the screen, a wider room puts them under the player list; kick buttons line up at the right', async () => {
  for (const size of ROOM_SIZES) {
    for (const p of [host, quinn]) {
      await p.page.setViewportSize(size);
      await p.page.evaluate(() => window.scrollTo(0, 0));
      const big = p === host ? 'start-game' : 'ready-toggle';
      // A phone, or one on its side (wide enough for the columns, too short for anything but the pinned footer).
      if (size.width < 768 || (size.width / size.height >= 1.5 && size.height <= 520)) {
        // A phone: the guest's page is short and the host's long, and either way Start or Ready sits on the bottom edge, the line across the page.
        await expect(p.page.getByTestId('lobby-actions')).toHaveCount(0);
        const footer = await p.page.getByTestId('lobby-footer').boundingBox();
        expect(Math.abs((footer?.y ?? 0) + (footer?.height ?? 0) - size.height), `${p.name} ${size.width}: the footer is on the bottom`).toBeLessThanOrEqual(1);
        expect(footer?.x ?? -1, 'its line starts at the left edge').toBeLessThanOrEqual(0.5);
        expect(footer?.width ?? 0, 'and spans the page').toBeGreaterThanOrEqual(size.width - 0.5);
        // Its controls line up with the page above them, edge for edge with the room's code card (sideways the host's Start
        // once stood 560px wide in the middle of a 780px page).
        const inner = await p.page.locator('.lobby__footer-inner').boundingBox();
        const card = await p.page.getByTestId('room-bar').boundingBox();
        expect(Math.abs((inner?.x ?? 0) - (card?.x ?? 1)), `${p.name} ${size.width}x${size.height}: Start's left edge on the page's`).toBeLessThanOrEqual(0.5);
        expect(Math.abs((inner?.x ?? 0) + (inner?.width ?? 0) - (card?.x ?? 0) - (card?.width ?? 1)), `${p.name} ${size.width}x${size.height}: and its right edge`).toBeLessThanOrEqual(0.5);
      } else {
        // A tablet or desktop: no footer and no line; the block sits under the player list, as wide as it, Start or Ready first and the row under it.
        await expect(p.page.getByTestId('lobby-footer')).toHaveCount(0);
        const list = await p.page.getByTestId('player-list').boundingBox();
        const block = await p.page.getByTestId('lobby-actions').boundingBox();
        expect(block?.y ?? 0, `${p.name} ${size.width}: the block is under the list`).toBeGreaterThanOrEqual((list?.y ?? 0) + (list?.height ?? 0));
        expect((block?.y ?? 0) - ((list?.y ?? 0) + (list?.height ?? 0)), 'close under it').toBeLessThanOrEqual(24);
        expect(Math.abs((block?.x ?? 0) - (list?.x ?? 1)), 'lined up with the list').toBeLessThanOrEqual(0.5);
        expect(Math.abs((block?.width ?? 0) - (list?.width ?? 1)), 'as wide as the list').toBeLessThanOrEqual(0.5);
        const main = await p.page.getByTestId(big).boundingBox();
        const sitOut = await p.page.getByTestId('sitout-toggle').boundingBox();
        const look = await p.page.getByTestId('edit-profile').boundingBox();
        expect(main?.height ?? 0, 'Start or Ready keeps its size').toBeGreaterThanOrEqual(60);
        expect(Math.abs((main?.x ?? 0) - (block?.x ?? 1))).toBeLessThanOrEqual(0.5);
        expect(sitOut?.y ?? 0, 'the row sits under it').toBeGreaterThanOrEqual((main?.y ?? 0) + (main?.height ?? 0));
        expect(Math.abs((sitOut?.y ?? 0) - (look?.y ?? 1)), 'one row').toBeLessThanOrEqual(0.5);
        expect(sitOut?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET);
        if (p === host) {
          const settings = await p.page.getByTestId('settings-panel').boundingBox();
          expect(settings?.x ?? 0, 'the settings column starts right of the block').toBeGreaterThanOrEqual((block?.x ?? 0) + (block?.width ?? 0));
        }
        // Nothing sticks to the bottom of the screen: the page scrolled to its end shows the block in the flow.
        const stuck = await p.page.evaluate(() => [...document.querySelectorAll('.lobby *')].some((el) => getComputedStyle(el).position === 'sticky'));
        expect(stuck, 'no sticky bar').toBe(false);
      }
      await noHorizontalOverflow(p.page, size.width);
    }
    // Each row's kick button is its last item: a 44px target after the status, every one in the same column.
    const rows = await host.page.getByTestId('player-item').evaluateAll((items) =>
      items.map((item) => {
        const kick = item.querySelector('[data-testid="kick-player"]')?.getBoundingClientRect() ?? null;
        const status = item.querySelector('[data-testid="player-status"]')?.getBoundingClientRect() ?? null;
        const row = item.getBoundingClientRect();
        return { kick: kick && { left: kick.left, right: kick.right, width: kick.width, height: kick.height }, statusRight: status?.right ?? 0, rowRight: row.right };
      }),
    );
    const kicks = rows.flatMap((r) => (r.kick ? [{ ...r.kick, statusRight: r.statusRight, rowRight: r.rowRight }] : []));
    expect(kicks).toHaveLength(3);
    for (const k of kicks) {
      expect(k.width).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(k.height).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(k.left, 'after the status').toBeGreaterThanOrEqual(k.statusRight - 0.5);
      expect(k.rowRight - k.right, 'at the far right').toBeLessThanOrEqual(8);
      expect(Math.abs(k.right - kicks[0].right), 'lined up').toBeLessThanOrEqual(0.5);
    }
  }
  for (const p of [host, quinn]) await p.page.setViewportSize(DESKTOP);
});

test('every player stays in reach on a laptop and a phone: the whole list shows, or a big party scrolls inside in whole rows under "+N more"', async ({ baseURL }) => {
  test.setTimeout(150_000);
  // Four players: no list that short ever scrolls inside; every row whole, the page reaching the last one where it must (the
  // 3-row floor once hid the fourth player at 1280x720, and a fixed cap cut the fourth row in half at 1024x768 and 1366x768).
  for (const size of LAPTOP_SIZES) {
    for (const p of [host, quinn]) {
      await p.page.setViewportSize(size);
      await p.page.evaluate(() => window.scrollTo(0, 0));
      expect((await expectPlayersInReach(p.page, `${p.name}, 4 players, ${size.width}x${size.height}`)).capped).toBe(false);
    }
  }
  for (const size of PHONE_SIZES) {
    for (const p of [host, pia]) {
      await p.page.setViewportSize(size);
      expect((await expectPlayersInReach(p.page, `${p.name}, 4 players, ${size.width}x${size.height}`)).capped).toBe(false);
    }
  }
  // Twelve: eight more join on bare sockets for this test alone and leave at its end.
  const bots = await tableBots(8, code, baseURL ?? 'http://localhost:4173', { game: 'poker' });
  try {
    for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(12);
    const capped: string[] = [];
    for (const size of LAPTOP_SIZES) {
      for (const p of [host, quinn]) {
        await p.page.setViewportSize(size);
        await p.page.evaluate(() => window.scrollTo(0, 0));
        if ((await expectPlayersInReach(p.page, `${p.name}, 12 players, ${size.width}x${size.height}`)).capped) capped.push(`${p.name} ${size.width}x${size.height}`);
      }
    }
    for (const size of PHONE_SIZES) {
      for (const p of [host, pia]) {
        await p.page.setViewportSize(size);
        if ((await expectPlayersInReach(p.page, `${p.name}, 12 players, ${size.width}x${size.height}`)).capped) capped.push(`${p.name} ${size.width}x${size.height}`);
      }
    }
    // A tall window shows all twelve; a short one (a laptop's browser, a phone on its side) scrolls the list inside.
    expect(capped).not.toContain(`${host.name} 1920x1080`);
    expect(capped).not.toContain(`${quinn.name} 1440x900`);
    for (const p of [host, quinn]) expect(capped).toContain(`${p.name} 1366x650`);
    for (const p of [host, pia]) expect(capped).toContain(`${p.name} 844x390`);
    // The common laptop (1366x768): the host's capped list, its "+N more" and Start all show at the page's top, the list the
    // one thing to scroll (the box once ran 200px under the fold, Start and the pill with it); a guest's at 1366x650 too.
    for (const [p, size] of [[host, LAPTOP], [quinn, LAPTOP_BROWSER]] as const) {
      await p.page.setViewportSize(size);
      await p.page.evaluate(() => window.scrollTo(0, 0));
      expect((await expectPlayersInReach(p.page, `${p.name}, 12 players, ${size.width}x${size.height}`)).capped).toBe(true);
      for (const id of ['player-list-more', p === host ? 'start-game' : 'ready-toggle', 'edit-profile']) await expectInsideViewport(p.page, id, size);
      expect(await p.page.evaluate(() => window.scrollY), `${p.name}: at the page's top`).toBe(0);
    }
    // The host's Start anyway step makes the block under the list taller: the list gives way again, and both choices are in reach.
    await host.page.setViewportSize(LANDSCAPE_TABLET);
    await host.page.evaluate(() => window.scrollTo(0, 0));
    await host.page.getByTestId('start-game').click();
    await expect(host.page.getByTestId('start-confirm')).toBeVisible();
    await expectPlayersInReach(host.page, `${host.name}, Start anyway, 1024x768`);
    await host.page.getByTestId('start-wait').scrollIntoViewIfNeeded();
    for (const id of ['start-anyway', 'start-wait']) await expectInsideViewport(host.page, id, LANDSCAPE_TABLET);
    await host.page.getByTestId('start-wait').click();
    await expect(host.page.getByTestId('start-confirm')).toHaveCount(0);
  } finally {
    for (const bot of bots) {
      bot.leave();
      bot.close();
    }
    for (const p of [host, quinn]) await p.page.setViewportSize(DESKTOP);
    await pia.page.setViewportSize(PORTRAIT);
    for (const p of players) await p.page.evaluate(() => window.scrollTo(0, 0));
  }
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(4);
});

test('Change my look is a centred box on a desktop and a drawer on a tablet or phone, its grids in full rows', async () => {
  const page = quinn.page;
  const grids = () =>
    page.evaluate(() => {
      const perRow = (selector: string) => {
        const tops = [...document.querySelectorAll(selector)].map((el) => Math.round(el.getBoundingClientRect().top));
        return tops.filter((t) => t === tops[0]).length;
      };
      return { faces: perRow('.avatar-picker__emojis > *'), colours: perRow('.avatar-picker__colors > *') };
    });
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await page.getByTestId('edit-profile').click();
    // Once it has popped in.
    await expect.poll(() => page.getByTestId('profile-sheet').locator('.sheet__panel').evaluate((el) => el.getAnimations().length)).toBe(0);
    const panel = await page.getByTestId('profile-sheet').locator('.sheet__panel').boundingBox();
    expect(Math.abs((panel?.x ?? 0) + (panel?.width ?? 0) / 2 - size.width / 2), 'centred across').toBeLessThanOrEqual(1);
    expect(Math.abs((panel?.y ?? 0) + (panel?.height ?? 0) / 2 - size.height / 2), 'and down').toBeLessThanOrEqual(1);
    expect(panel?.y ?? 0, 'off the top edge').toBeGreaterThan(0);
    expect(await grids()).toEqual({ faces: 10, colours: 6 });
    // Escape closes it, and so does a click on the dimmed page around it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('profile-sheet')).toHaveCount(0);
    await page.getByTestId('edit-profile').click();
    await page.getByTestId('profile-sheet-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('profile-sheet')).toHaveCount(0);
  }
  for (const size of [{ width: 768, height: 1024 }, PORTRAIT, SMALL]) {
    await page.setViewportSize(size);
    await page.getByTestId('edit-profile').click();
    // Once it has slid up.
    const bottom = async () => {
      const panel = await page.getByTestId('profile-sheet').locator('.sheet__panel').boundingBox();
      return Math.abs((panel?.y ?? 0) + (panel?.height ?? 0) - size.height);
    };
    await expect.poll(bottom, { message: `${size.width}: a drawer from the bottom` }).toBeLessThanOrEqual(1);
    expect((await grids()).colours).toBe(6);
    expect([5, 10]).toContain((await grids()).faces);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('profile-sheet')).toHaveCount(0);
  }
  await page.setViewportSize(DESKTOP);
});

test('players ready up: the count follows, Start waits for enough ready players and names who is not', async () => {
  // Click Race needs one player: the host alone (ready by pressing Start) could begin, but the others are not ready.
  await expect(host.page.getByTestId('player-count')).toHaveText('1 of 4 ready');
  await expectReadyCount(host.page, 1);
  for (const g of guests()) await expect(g.page.locator(`[data-testid="player-item"][data-name="${g.name}"]`)).toHaveAttribute('data-status', 'notReady');

  // Starting now would sit the others out: the host is asked first and waits.
  await host.page.getByTestId('start-game').click();
  await expect(host.page.getByTestId('start-confirm')).toContainText(`${pia.name}, ${quinn.name} and ${rae.name}`);
  // The step survives the controls moving between the column and a phone's footer (a tablet turned, a window resized).
  await host.page.setViewportSize(PORTRAIT);
  await expect(host.page.getByTestId('lobby-footer').getByTestId('start-confirm')).toContainText(`${pia.name}, ${quinn.name} and ${rae.name}`);
  await host.page.setViewportSize(DESKTOP);
  await expect(host.page.getByTestId('lobby-actions').getByTestId('start-confirm')).toBeVisible();
  await host.page.getByTestId('start-wait').click();
  await expect(host.page.getByTestId('start-confirm')).toHaveCount(0);

  await readyAll(guests().map((g) => g.page));
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
  await expectReadyCount(host.page, 4);
  for (const p of players) await expect(p.page.locator(`[data-testid="player-item"][data-name="${pia.name}"]`)).toHaveAttribute('data-status', 'ready');
  await expect(host.page.getByTestId('start-game')).toContainText('Start · 4 ready');
});

test('the race ends: everyone is back in the lobby with the results over it, the winner celebrated; Enter changes nothing', async () => {
  await host.page.getByTestId('settings-targetClicks').fill('10');
  await expect(host.page.getByTestId('settings-value-targetClicks')).toHaveText('10');
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(p.page.getByTestId('click-button')).toBeVisible();
  for (let i = 0; i < 2; i++) await quinn.page.getByTestId('click-button').click();
  for (let i = 0; i < 10; i++) await host.page.getByTestId('click-button').click();

  for (const p of players) {
    await expectResults(p.page);
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end.getByTestId('results-headline')).toHaveText(`${host.name} wins!`);
    await expect(end.getByTestId('results-entry')).toHaveCount(4);
    await expect(end.getByTestId('confetti')).toBeAttached();
    // It ran its course: no reason line.
    await expect(end.getByTestId('results-reason')).toHaveCount(0);
    // Straight back to the lobby: no game screen under the popup, nothing holding anyone.
    await expect(p.page.getByTestId('click-button')).toHaveCount(0);
  }
  await expect(host.page.getByTestId('overlay-game-end')).toHaveAttribute('data-winner', 'true');
  await expect(host.page.getByTestId('results-place')).toHaveText('You won!');
  await expect(quinn.page.getByTestId('results-place')).toHaveText('You came 2nd');
  await expect(quinn.page.getByTestId('overlay-game-end')).toHaveAttribute('data-winner', 'false');
  for (const p of players) await expect(p.page.getByTestId('play-again')).toHaveCount(0);

  // The phone popup fits the screen, Back to the room a full-size target.
  await noHorizontalOverflow(pia.page, PORTRAIT.width);
  await expectInsideViewport(pia.page, 'results-card', PORTRAIT);
  await expect
    .poll(async () => (await pia.page.getByTestId('results-done').boundingBox())?.height ?? 0, { message: 'Back to the room is a 44px target' })
    .toBeGreaterThanOrEqual(MIN_TARGET);

  // On a small phone the standings scroll inside the card while Back to the room stays on screen.
  await host.page.setViewportSize(SMALL);
  await expect(host.page.getByTestId('overlay-game-end')).toBeVisible();
  for (const id of ['results-done', 'results-close']) await expectInsideViewport(host.page, id, SMALL);
  await host.page.setViewportSize(DESKTOP);

  // The regression: Enter (the thumb still on the keyboard's send key) leaves nobody.
  for (const p of players) {
    await expect.poll(() => p.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('results-card');
    await p.page.keyboard.press('Enter');
    await p.page.keyboard.press('Enter');
    await p.page.waitForTimeout(400);
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
    expect(await seatCode(p.page)).toBe(code);
  }
});

test('a reload while the results are up shows them again; each player closes them their own way and stays in the lobby', async () => {
  await quinn.page.reload();
  await expectResults(quinn.page);
  await expect(quinn.page.getByTestId('results-place')).toHaveText('You came 2nd');

  // The button, the X, Escape and (on a desktop) a tap beside the card all close it.
  await closeResults(host.page);
  // A tap beside the card on a phone does nothing: the scores never go by accident.
  await pia.page.touchscreen.tap(6, PORTRAIT.height - 6);
  await pia.page.waitForTimeout(300);
  await expect(pia.page.getByTestId('overlay-game-end')).toBeVisible();
  await pia.page.getByTestId('results-close').click();
  await quinn.page.keyboard.press('Escape');
  await rae.page.mouse.click(8, 8);
  for (const p of players) {
    await expect(p.page.getByTestId('overlay-game-end')).toHaveCount(0);
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
    expect(await seatCode(p.page)).toBe(code);
  }
  // Closed for good: a reload does not bring them back.
  await host.page.reload();
  await expect(host.page.getByTestId('room-code')).toHaveText(code);
  await host.page.waitForTimeout(500);
  await expect(host.page.getByTestId('overlay-game-end')).toHaveCount(0);

  // Everyone readies up for the next game.
  await readyAll(guests().map((p) => p.page));
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
});

test('the lobby keeps the party, and the host switches it to The Spy Game: the URL follows everywhere, nobody rejoins', async () => {
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
  }
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');

  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
  for (const p of players) {
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${code}$`));
    await expect(p.page).toHaveTitle(roomTabTitle(code));
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
    await expect(p.page.getByTestId('home-join')).toHaveCount(0);
    expect(await seatCode(p.page)).toBe(code);
  }
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]')).toHaveAttribute('aria-checked', 'true');
  await expect(pia.page.getByTestId('game-picker').getByTestId('game-tile')).toHaveAttribute('data-game', 'spygame');
  await expect(host.page.getByTestId('settings-rounds')).toBeVisible();
  await expect(host.page.getByTestId('settings-targetClicks')).toHaveCount(0);
  // The Spy Game reads the content mode: Family and Unhinged, nothing in between (and only the host sees it).
  await expect(host.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'family');
  await expect(host.page.locator('[data-testid^="content-mode-"]')).toHaveCount(2);
  await expect(host.page.getByTestId('content-mode-cheeky')).toHaveCount(0);
  await expect(pia.page.locator('[data-testid^="content-mode-"]')).toHaveCount(0);
  // Ready flags carried over; the Spy Game's own settings start fresh.
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('5');
  // A dragged slider glides under the pointer (no step grid while held) and snaps to a whole step when let go.
  const slider = host.page.getByTestId('settings-rounds');
  const box = (await slider.boundingBox())!;
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const thumbX = box.x + 11 + ((5 - min) / (max - min)) * (box.width - 22);
  await host.page.mouse.move(thumbX, box.y + box.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(thumbX - box.width * 0.17, box.y + box.height / 2, { steps: 6 });
  await expect(slider).toHaveAttribute('step', 'any');
  expect(Number(await slider.inputValue()) % 1).not.toBe(0);
  await host.page.mouse.up();
  await expect(slider).toHaveAttribute('step', '1');
  const landed = Number(await slider.inputValue());
  expect(landed % 1).toBe(0);
  expect(landed).toBeLessThan(5);
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText(String(landed));
});

test('How to play shows the rules of the game picked, follows the host’s switch, and Escape closes it back onto its button', async () => {
  // On a desktop the card is a popover hanging off the button, with the room still usable under it.
  const page = quinn.page;
  const button = page.getByTestId('how-to-play');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const popover = page.getByRole('dialog', { name: 'How to play The Spy Game' });
  await expect(popover).toBeVisible();
  await expect(popover).toHaveAttribute('data-testid', 'how-to-play-popover');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const card = page.getByTestId('how-to-play-card');
  await expect(card).toHaveAttribute('data-mode', 'popover');
  await expect(card.getByTestId('rules-name')).toHaveText('The Spy Game');
  await expect(card.getByTestId('rules-section')).toHaveCount(5);
  await expect(card.getByTestId('rules-section').first()).toContainText('How a round goes');
  // The hero (the place card and the spy's) and the four key facts, the round clock first, from the shared constant.
  await expect(card.getByTestId('rules-hero')).toHaveAttribute('data-kind', 'place');
  await expect(card.getByTestId('rules-fact')).toHaveCount(4);
  await expect(card.getByTestId('rules-fact').first()).toContainText(`${SPYGAME_ROUND_MINUTES} min`);
  await expect(card).toContainText('Watching');
  // A guest's button sits high in the column: the whole card hangs right under it, from its left edge, inside the screen and
  // clear of the room bar, and nothing dims the room (the players stay reachable).
  await expect(popover).toHaveAttribute('data-side', 'below');
  const anchor = await button.boundingBox();
  const panel = await popover.boundingBox();
  const gapBelow = (panel?.y ?? 0) - ((anchor?.y ?? 0) + (anchor?.height ?? 0));
  expect(gapBelow, 'right under the button').toBeGreaterThanOrEqual(0);
  expect(gapBelow, 'right under the button').toBeLessThanOrEqual(16);
  // From the button's left edge to the guest's column's right edge (the room bar's), never past it.
  const guestBar = await page.locator('.lobby__top').boundingBox();
  expect(Math.abs((panel?.x ?? 0) - (anchor?.x ?? 0)), 'lined up with the button’s left edge').toBeLessThanOrEqual(1);
  expect(Math.abs((panel?.x ?? 0) + (panel?.width ?? 0) - (guestBar?.x ?? 0) - (guestBar?.width ?? 1)), 'and the column’s right edge').toBeLessThanOrEqual(1);
  await expectRulesCardPlaced(page, DESKTOP, true);
  await expect(page.locator('.sheet__backdrop')).toHaveCount(0);
  const firstRow = page.getByTestId('player-item').first();
  const rowBox = await firstRow.boundingBox();
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="player-item"]') !== null, [(rowBox?.x ?? 0) + 24, (rowBox?.y ?? 0) + (rowBox?.height ?? 0) / 2]);
  expect(under, 'the players list is not covered').toBe(true);

  // The host switches the game while the card is open: the card follows, to a card table's hands.
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="blackjack"]').click();
  await expect(page.getByTestId('game-picker')).toHaveAttribute('data-game', 'blackjack');
  await expect(page.getByRole('dialog', { name: 'How to play Blackjack' })).toBeVisible();
  await expect(card.getByTestId('rules-name')).toHaveText('Blackjack');
  await expect(card.getByTestId('rules-section').first()).toContainText('How a hand goes');
  await expect(card.getByTestId('rules-hero')).toHaveAttribute('data-kind', 'cards');
  await expect(card.getByTestId('rules-fact').nth(2)).toContainText(`Stands on ${DEALER_STANDS_AT}`);
  await expect(page.getByTestId('game-picker-meta')).toHaveCount(0);
  await expect(host.page.getByTestId('game-picker-meta')).toHaveText('Blackjack · 1+ players');

  // Escape closes it and hands the focus back to the button.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('how-to-play-popover')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('how-to-play');

  // The host's own card follows a tile press too, instead of closing: back to The Spy Game for the rest of the party.
  const hostButton = host.page.getByTestId('how-to-play');
  await hostButton.click();
  await expect(host.page.getByRole('dialog', { name: 'How to play Blackjack' })).toBeVisible();
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
  for (const p of players) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
  await expect(host.page.getByRole('dialog', { name: 'How to play The Spy Game' })).toBeVisible();
  await expect(hostButton).toHaveAttribute('aria-expanded', 'true');
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('how-to-play-popover')).toHaveCount(0);

  // The host's button sits low, under the tiles. On a 1440x900 window neither under it nor over it holds the card, and beside it
  // the page leaves one column, a little too tall for the window: the card stands beside the button, from under the room bar
  // to the window's foot, scrolling the little it lacks (never the whole card slid over its own button, the players' statuses
  // and Start, which it once covered down to "Start · 3 reac"), inside the page (its right edge the room bar's; it once ran
  // 144px past it), clear of the room code, every other game's tile left a part to press.
  await host.page.setViewportSize(WIDE);
  await hostButton.click();
  await expect(host.page.getByTestId('how-to-play-popover')).toHaveAttribute('data-side', 'right');
  await expectRulesCardPlaced(host.page, WIDE, false);
  await expect(host.page.getByTestId('rules-section')).toHaveCount(5);
  for (const [other, point] of Object.entries(await tilePoints(host.page))) if (other !== 'spygame') expect(point, `1440x900: the ${other} tile keeps a part to press`).not.toBeNull();
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('how-to-play-popover')).toHaveCount(0);

  // At every laptop size the host's card stands beside the button the same way (1440x900, 1366x768, 1280x720, 1024x768): from the
  // page's right edge, scrolling, clear of the button, of every tile, of the players' rows and of Start, over the settings only;
  // the window's height decides how much of it shows (all of it on a 1920x1080 screen). Every other game keeps a part to press
  // while the card is open: a press there switches the game, and the card follows, placed again for the new rules.
  for (const size of [WIDE, LAPTOP, HD, LANDSCAPE_TABLET]) {
    const label = `${size.width}x${size.height}`;
    await host.page.setViewportSize(size);
    await host.page.evaluate(() => window.scrollTo(0, 0));
    await hostButton.click();
    const popover = host.page.getByTestId('how-to-play-popover');
    await expect(popover).toHaveAttribute('data-side', 'right');
    await expect(popover).toHaveAttribute('data-scrolls', 'true');
    await expectRulesCardPlaced(host.page, size, false);
    const card = await popover.boundingBox();
    const button = await hostButton.boundingBox();
    const actions = await host.page.getByTestId('lobby-actions').boundingBox();
    const list = await host.page.getByTestId('player-list').boundingBox();
    const bar = await host.page.locator('.lobby__top').boundingBox();
    expect(card?.x ?? 0, `${label}: beside the button, clear of it, of the tiles, of the players' rows and of Start`).toBeGreaterThanOrEqual(Math.max((button?.x ?? 0) + (button?.width ?? 0), (actions?.x ?? 0) + (actions?.width ?? 0), (list?.x ?? 0) + (list?.width ?? 0)));
    expect(Math.abs((card?.x ?? 0) + (card?.width ?? 0) - (bar?.x ?? 0) - (bar?.width ?? 1)), `${label}: to the page's right edge`).toBeLessThanOrEqual(1);
    // Most of the card shows: the rules box holds more than half of what it scrolls.
    const shown = await host.page.locator('.how-to-play__scroll').evaluate((el) => el.clientHeight / el.scrollHeight);
    expect(shown, `${label}: most of the card shows`).toBeGreaterThan(0.5);
    // Start takes a press all along its width with the card open.
    const pressable = await host.page.getByTestId('start-game').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [0.1, 0.5, 0.9].map((f) => el.contains(document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2)));
    });
    expect(pressable, `${label}: Start takes a press at its left end, its middle and its right end`).toEqual([true, true, true]);
    let picked = 'spygame';
    for (const game of ['scribble', 'quipgame', 'blackjack', 'poker', 'spygame']) {
      const points = await tilePoints(host.page);
      for (const [other, point] of Object.entries(points)) if (other !== picked) expect(point, `${label}, ${picked} picked: the ${other} tile keeps a part to press`).not.toBeNull();
      const point = points[game];
      if (!point) throw new Error(`${label}: no part of the ${game} tile to press`);
      await host.page.mouse.click(point.x, point.y);
      await expect(host.page.getByTestId('game-picker')).toHaveAttribute('data-game', game);
      picked = game;
      await expect(host.page.getByTestId('how-to-play-card')).toHaveAttribute('data-game', game);
      await expect(hostButton).toHaveAttribute('aria-expanded', 'true');
      await expectRulesCardPlaced(host.page, size, false);
    }
    await host.page.keyboard.press('Escape');
    await expect(host.page.getByTestId('how-to-play-popover')).toHaveCount(0);
  }
  for (const p of players) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
  // A 1280x600 window is too short for the whole card anywhere: it scrolls beside the host's button and under the guest's (two
  // thirds of it showing, as the whole card hangs there on a taller window), inside the window, under the room bar, its close
  // button in a head above the rules and the cut edge fading; scrolled to the end, the last section shows.
  for (const p of [host, quinn]) {
    await p.page.setViewportSize(SHORT);
    await p.page.evaluate(() => window.scrollTo(0, 0));
    await p.page.getByTestId('how-to-play').click();
    await expect(p.page.getByTestId('how-to-play-popover')).toHaveAttribute('data-scrolls', 'true');
    await expectRulesCardPlaced(p.page, SHORT, false);
    const shortPanel = await p.page.getByTestId('how-to-play-popover').boundingBox();
    await p.page.locator('.how-to-play__scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const lastSection = await p.page.getByTestId('rules-section').last().boundingBox();
    expect((lastSection?.y ?? 0) + (lastSection?.height ?? 0), 'the last section scrolls into view inside the card').toBeLessThanOrEqual((shortPanel?.y ?? 0) + (shortPanel?.height ?? 0) + 0.5);
    await expect(p.page.locator('.how-to-play__scroll')).toHaveAttribute('data-fade', 'top');
    await p.page.keyboard.press('Escape');
    await expect(p.page.getByTestId('how-to-play-popover')).toHaveCount(0);
    // And the guest's card on a 1440x900 window: whole, under its button.
    if (p === quinn) {
      await p.page.setViewportSize(WIDE);
      await p.page.getByTestId('how-to-play').click();
      await expect(p.page.getByTestId('how-to-play-popover')).toHaveAttribute('data-side', 'below');
      await expectRulesCardPlaced(p.page, WIDE, true);
      await p.page.keyboard.press('Escape');
      await expect(p.page.getByTestId('how-to-play-popover')).toHaveCount(0);
    }
    await p.page.setViewportSize(DESKTOP);
  }
  // A 1280x500 window takes the phone's layout, Start and Ready in the footer pinned to its foot. The host's card, opened from
  // the button scrolled into view, scrolls beside it and stops 16px over the footer, so Start takes a press all along. A guest's
  // has under 200px between the room bar and the footer: it runs over the footer rather than squeeze, and never over the code.
  for (const p of [host, quinn]) {
    await p.page.setViewportSize(LETTERBOX);
    const openButton = p.page.getByTestId('how-to-play');
    await openButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await openButton.click();
    await expect(p.page.getByTestId('how-to-play-popover')).toHaveAttribute('data-scrolls', 'true');
    await expectRulesCardPlaced(p.page, LETTERBOX, false);
    if (p === host) {
      const card = await p.page.getByTestId('how-to-play-popover').boundingBox();
      const footer = await p.page.getByTestId('lobby-footer').boundingBox();
      expect((card?.y ?? 0) + (card?.height ?? 0), 'the card stops short of the pinned footer').toBeLessThanOrEqual((footer?.y ?? 0) - 16 + 0.5);
      const pressable = await p.page.getByTestId('start-game').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [0.1, 0.5, 0.9].map((f) => el.contains(document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2)));
      });
      expect(pressable, 'Start takes a press at its left end, its middle and its right end').toEqual([true, true, true]);
    }
    await p.page.keyboard.press('Escape');
    await expect(p.page.getByTestId('how-to-play-popover')).toHaveCount(0);
    await p.page.setViewportSize(DESKTOP);
    await p.page.evaluate(() => window.scrollTo(0, 0));
  }
  await host.page.setViewportSize(DESKTOP);

  // On a phone the rules come up in the sheet; the button is a 44px target that fits beside the picker at 390, 360 and 320.
  for (const size of [PORTRAIT, MID, SMALL]) {
    await pia.page.setViewportSize(size);
    const phoneButton = pia.page.getByTestId('how-to-play');
    const box = await phoneButton.boundingBox();
    expect(box?.height ?? 0, `${size.width}: a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${size.width}: fits the screen`).toBeLessThanOrEqual(size.width + 0.5);
    const note = await pia.page.getByTestId('game-picker-note').boundingBox();
    expect(box?.y ?? 0, `${size.width}: under who picks, never over it`).toBeGreaterThanOrEqual((note?.y ?? 0) + (note?.height ?? 0) - 0.5);
    await noHorizontalOverflow(pia.page, size.width);
    await phoneButton.click();
    const sheet = pia.page.getByRole('dialog', { name: 'How to play The Spy Game' });
    await expect(sheet).toHaveAttribute('data-testid', 'how-to-play-sheet');
    await expect(pia.page.getByTestId('how-to-play-card')).toHaveAttribute('data-mode', 'sheet');
    await expect(sheet.getByTestId('rules-name')).toHaveText('The Spy Game');
    await expect(sheet.getByTestId('rules-section')).toHaveCount(5);
    await expect(sheet.getByTestId('rules-fact')).toHaveCount(4);
    // The hero and the tiles fit the sheet: no sideways scroll, and every big value keeps to its tile.
    const keepsToTiles = async (game: string) => {
      await noHorizontalOverflow(pia.page, size.width);
      const clipped = await pia.page.evaluate(() => [...document.querySelectorAll('.rules-fact__value')].filter((el) => el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent));
      expect(clipped, `${size.width}: every key fact of ${game} keeps to its tile`).toEqual([]);
    };
    await keepsToTiles('The Spy Game');
    // The sheet follows the host's switch like the popover does, so Blackjack's "Stands on 17", the longest value, is measured at this size too.
    await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="blackjack"]').click();
    const blackjackSheet = pia.page.getByRole('dialog', { name: 'How to play Blackjack' });
    await expect(blackjackSheet).toBeVisible();
    await expect(blackjackSheet.getByTestId('rules-fact').nth(2)).toContainText(`Stands on ${DEALER_STANDS_AT}`);
    await keepsToTiles('Blackjack');
    await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
    await expect(sheet).toBeVisible();
    await expectInsideViewport(pia.page, 'how-to-play-sheet-close', size);
    await pia.page.keyboard.press('Escape');
    await expect(pia.page.getByTestId('how-to-play-sheet')).toHaveCount(0);
    await expect.poll(() => pia.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('how-to-play');
  }
  await pia.page.setViewportSize(PORTRAIT);
  // The host's button, beside the game's line under the tiles, is a 44px target on a small phone too.
  for (const size of [PORTRAIT, SMALL]) {
    await host.page.setViewportSize(size);
    await host.page.evaluate(() => window.scrollTo(0, 0));
    const box = await host.page.getByTestId('how-to-play').boundingBox();
    const meta = await host.page.getByTestId('game-picker-meta').boundingBox();
    expect(box?.height ?? 0, `${size.width}: the host's button is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 0.5);
    // One row: the line ends before the button, which stays in the first screen above the sticky footer.
    expect((meta?.x ?? 0) + (meta?.width ?? 0), `${size.width}: the line ends before the button`).toBeLessThanOrEqual((box?.x ?? 0) + 0.5);
    const hostFooter = await host.page.getByTestId('lobby-footer').boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0), `${size.width}: the button is above the footer without scrolling`).toBeLessThanOrEqual((hostFooter?.y ?? 0) + 0.5);
    await noHorizontalOverflow(host.page, size.width);
  }
  await host.page.setViewportSize(DESKTOP);
});

test('How to play reads cleanly for every game on a phone and a desktop: no line ends on a hyphen or a number, no word alone, every badge clear of its picture', async () => {
  test.setTimeout(120_000);
  const names: Record<string, string> = { scribble: 'Scribble', spygame: 'The Spy Game', quipgame: 'Quip Game', blackjack: 'Blackjack', poker: 'Poker' };
  for (const [game, name] of Object.entries(names)) {
    await host.page.getByTestId('game-picker').locator(`[data-testid="game-tile"][data-game="${game}"]`).click();
    await expect(pia.page.getByTestId('game-picker')).toHaveAttribute('data-game', game);
    // The phone's sheet at 390, 360 and 320 ("Join mid-" / "game", "words to choose from (2 to" / "5).", "Take every vote, 2" /
    // "or more" and "guess" alone in Scribble's summary all once stood there).
    for (const size of [PORTRAIT, MID, SMALL]) {
      // The badge at the picture's corner covers none of its key shapes (Scribble's pencil and house once hid under it).
      await pia.page.setViewportSize(size);
      await expectRulesReadCleanly(pia.page, name, `${name} at ${size.width}`);
      await expect(pia.page.getByTestId('how-to-play-sheet')).toHaveCount(0);
    }
    // The host's desktop card, two columns ("4 points (3" / "on the second guess)" once stood at 1440).
    for (const size of [WIDE, LAPTOP, HD]) {
      await host.page.setViewportSize(size);
      await host.page.evaluate(() => window.scrollTo(0, 0));
      await expectRulesReadCleanly(host.page, name, `${name} at ${size.width}x${size.height}`);
      await expect(host.page.getByTestId('how-to-play-popover')).toHaveCount(0);
    }
  }
  // Back to The Spy Game for the rest of the party.
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
  for (const p of players) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
  await host.page.setViewportSize(DESKTOP);
  await pia.page.setViewportSize(PORTRAIT);
});

test('one player sits out, the host sets Unhinged, three play a one-round Spy Game while the fourth watches from the party', async () => {
  test.setTimeout(90_000);
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.getByTestId('ready-controls')).toHaveAttribute('data-sitting-out', 'true');
  // Sitting out: only Count me in, with the hint; no disabled ready button next to it.
  await expect(rae.page.getByTestId('ready-toggle')).toHaveCount(0);
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Count me in');
  await expect(rae.page.getByTestId('sitout-hint')).toHaveText("You’ll watch the next game.");
  await expect(rae.page.getByTestId('ready-controls').getByRole('button')).toHaveText(['Count me in', 'Change my look']);
  for (const p of players) await expect(p.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'sittingOut');
  await expect(host.page.getByTestId('player-count')).toHaveText('3 of 3 ready');

  // The content cards fit their column at every width, the narrow tablet column too: on a 768px tablet (the settings column
  // beside the players) they stack, each tag and tick inside its card; at 1024 they sit side by side. Family picked, then Unhinged.
  const contentSizes = [PORTRAIT_TABLET, LANDSCAPE_TABLET];
  for (const size of contentSizes) {
    await host.page.setViewportSize(size);
    await expectContentCardsFit(host.page, `${size.width}px, Family picked`);
  }
  await host.page.getByTestId('content-mode-unhinged').click();
  await expect(host.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
  await expect(host.page.getByTestId('content-mode-unhinged')).toHaveAttribute('aria-checked', 'true');
  await expect(host.page.getByTestId('content-mode-unhinged')).toContainText('18+');
  for (const size of contentSizes) {
    await host.page.setViewportSize(size);
    await expectContentCardsFit(host.page, `${size.width}px, Unhinged picked`);
  }
  const [family, unhinged] = await Promise.all(['family', 'unhinged'].map((m) => host.page.getByTestId(`content-mode-${m}`).boundingBox()));
  expect(unhinged?.x ?? 0, '1024px: side by side').toBeGreaterThan((family?.x ?? 0) + (family?.width ?? 0) - 0.5);
  await host.page.setViewportSize(PORTRAIT_TABLET);
  const [familyTall, unhingedTall] = await Promise.all(['family', 'unhinged'].map((m) => host.page.getByTestId(`content-mode-${m}`).boundingBox()));
  expect(unhingedTall?.y ?? 0, '768px: stacked').toBeGreaterThan((familyTall?.y ?? 0) + (familyTall?.height ?? 0) - 0.5);
  await host.page.setViewportSize(DESKTOP);

  await host.page.getByTestId('settings-rounds').fill('1');
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('1');
  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await expect(host.page.getByTestId('start-confirm')).toHaveCount(0);
  await host.page.getByTestId('start-game').click();

  const playing = [host, pia, quinn];
  for (const p of playing) await expect(p.page.getByTestId('spygame-role')).toBeVisible();
  // The sitting-out player watches from inside the room: a spectator role, their seat intact.
  await expect(rae.page.getByTestId('spygame-role')).toHaveAttribute('data-role', 'spectator');
  await expect(rae.page).toHaveURL(new RegExp(`/spygame/${code}$`));
  await expect(rae.page.getByTestId('home-join')).toHaveCount(0);
  await rae.page.getByTestId('players-toggle').click();
  await expect(rae.page.getByTestId('players-sheet').getByTestId('player-item')).toHaveCount(4);
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`).getByTestId('player-sitting-out')).toBeVisible();
  await rae.page.getByTestId('players-sheet-close').click();
  const roles = await Promise.all(playing.map(async (p) => (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? ''));
  expect(roles.filter((r) => r === 'spy')).toHaveLength(1);
  expect(roles.filter((r) => r === 'agent')).toHaveLength(2);

  // The spy ends the round by naming the location; the lobby follows with the results over it.
  const spy = playing[roles.indexOf('spy')];
  const agent = playing[roles.indexOf('agent')];
  const locationId = (await agent.page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
  expect(locationId).not.toBe('');
  const tile = spy.page.locator(`[data-testid="guess-tile"][data-location-id="${locationId}"]`);
  await tile.click();
  await tile.click();
  await expect(host.page.getByTestId('spygame-next-round')).toContainText('Show results');
  await host.page.getByTestId('spygame-next-round').click();
  for (const p of players) await expectResults(p.page);
  await expect(spy.page.getByTestId('results-place')).toHaveText('You won!');
  // Rae watched the whole game: she sees how it ended too, and is not in the standings.
  await expect(rae.page.getByTestId('results-place')).toHaveText('You watched this one');
  await expect(rae.page.getByTestId('overlay-game-end').getByTestId('results-entry')).toHaveCount(3);

  for (const p of players) await closeResults(p.page);
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${code}$`));
  }
  // The sit-out choice persists until Rae comes back in.
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'sittingOut');
  // Count me in comes back in and readies in one tap.
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Count me in');
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'ready');
  await expect(rae.page.getByTestId('ready-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(rae.page.getByTestId('ready-toggle')).toContainText("You’re ready");
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Sit this one out');

  // The content mode is hidden for a game that never reads it, and comes back unchanged with one that does.
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="poker"]').click();
  for (const p of players) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'poker');
  await expect(host.page.getByTestId('settings-contentMode')).toHaveCount(0);
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="quipgame"]').click();
  await expect(host.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
});

test('the host leaves: the new host gets the settings and the game picker at once', async () => {
  await leaveLobby(host.page);
  const rest = guests();
  for (const p of rest) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
  // The host role goes to the longest-connected guest, Pia; her room grows the settings and the grid with no reload.
  const crowned = pia;
  await expect(crowned.page.locator(`[data-testid="player-item"][data-name="${crowned.name}"]`).getByTestId('host-crown')).toBeVisible();
  await expect(crowned.page.getByTestId('settings-panel')).toBeVisible();
  await expect(crowned.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
  await expect(crowned.page.locator('button[data-testid="game-tile"]')).toHaveCount(5);
  await expect(crowned.page.getByTestId('start-game')).toBeVisible();
  for (const p of rest.filter((x) => x !== crowned)) {
    await expect(p.page.getByTestId('settings-panel')).toHaveCount(0);
    await expect(p.page.getByTestId('game-picker-note')).toHaveText(`${crowned.name} picks the game`);
  }
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
