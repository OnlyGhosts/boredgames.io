import { expect, type Page } from '@playwright/test';
import { GAME_LIST } from '../shared/platform/games';

/** The slug a new party starts on: the first live game (Scribble). */
export const FIRST_LIVE_SLUG = (GAME_LIST.find((g) => g.status === 'live') ?? GAME_LIST[0]).slug;

/**
 * Shared steps for the party lobby. A game only starts with the players who readied up (the host
 * counts as ready by pressing Start), so every spec readies its non-host pages before starting.
 */
export async function readyAll(pages: Page[]): Promise<void> {
  for (const page of pages) {
    // A player sitting out has one button, Count me in, which comes back in and readies at once.
    const countMeIn = page.locator('[data-testid="ready-controls"][data-sitting-out="true"] [data-testid="sitout-toggle"]');
    if (await countMeIn.isVisible()) await countMeIn.click();
    const toggle = page.getByTestId('ready-toggle');
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
}

/** "Start · N ready" on the host's page once N players are counted. */
export async function expectReadyCount(hostPage: Page, count: number): Promise<void> {
  await expect(hostPage.getByTestId('start-game')).toHaveAttribute('data-ready', String(count));
}

export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/** The browser tab inside a room: the site, a door and the code in Mathematical Sans-Serif Bold ("boredgames.io 🚪 𝗔𝗕𝟮𝟯"). */
export function roomTabTitle(code: string): string {
  const bold = [...code].map((ch) => String.fromCodePoint(/\d/.test(ch) ? 0x1d7ec + Number(ch) : 0x1d5d4 + ch.charCodeAt(0) - 65)).join('');
  return `boredgames.io \u{1F6AA} ${bold}`;
}

/** The code shown in the lobby. */
export async function readRoomCode(page: Page): Promise<string> {
  const code = ((await page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(ROOM_CODE_RE);
  return code;
}

/**
 * The "Who's playing?" step after Join room / Create room: shown on a first visit, skipped once a
 * name is saved on the device. Fills it when it shows; either way the lobby is next (or, for a
 * join the server refuses, the front door again with the error).
 */
export async function enterNameIfAsked(page: Page, name: string): Promise<void> {
  const step = page.getByTestId('name-step');
  const settled = step.or(page.getByTestId('room-code')).or(page.getByTestId('join-error'));
  await expect(settled.first()).toBeVisible();
  if (await step.isVisible()) {
    await page.getByTestId('home-name').fill(name);
    await page.getByTestId('home-continue').click();
  }
}

/**
 * Creates a party from the front door and returns its code. `gameSlug` picks the game the party
 * starts on ('/?game=slug', the only way to reach the hidden template game); otherwise the first
 * live game, and the host picks another in the lobby.
 */
export async function createParty(page: Page, name: string, gameSlug?: string, base = ''): Promise<string> {
  await page.goto(`${base}/${gameSlug ? `?game=${gameSlug}` : ''}`);
  await expect(page.getByTestId('home-create')).toBeVisible();
  await page.getByTestId('home-create').click();
  await enterNameIfAsked(page, name);
  const code = await readRoomCode(page);
  await expect(page).toHaveURL(new RegExp(`/${gameSlug ?? FIRST_LIVE_SLUG}/${code}$`));
  return code;
}

/** Types the code into the four boxes (they auto-advance) and joins. */
export async function joinByCode(page: Page, name: string, code: string, base = ''): Promise<void> {
  await page.goto(`${base}/`);
  await page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await page.getByTestId('home-join').click();
  await enterNameIfAsked(page, name);
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

/** Opens an invite link ('/:slug/:CODE' or '/:CODE'): the boxes are filled, one tap joins. */
export async function joinByLink(page: Page, name: string, path: string, code: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('code-input-3')).toHaveValue(code[3]);
  await page.getByTestId('home-join').click();
  await enterNameIfAsked(page, name);
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

/** Leaves from the lobby: the room bar's Leave, then Leave room in the confirmation. */
export async function leaveLobby(page: Page): Promise<void> {
  await page.getByTestId('leave-room').click();
  await page.getByTestId('lobby-leave-yes').click();
}

/** Leaves from a game screen: the top bar's Leave (on a phone, Leave room in the options sheet), then Leave room in the confirmation. */
export async function leaveGame(page: Page): Promise<void> {
  const menu = page.getByTestId('game-menu');
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId('leave-room').click();
  await page.getByTestId('game-leave-yes').click();
}

/**
 * The host's End game: on a phone through the options sheet, on a desktop the top bar's button;
 * either way the confirm step's End game.
 */
export async function endGameAsHost(page: Page): Promise<void> {
  const menu = page.getByTestId('game-menu');
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId('end-game').click();
  await expect(page.getByTestId('end-game-confirm')).toContainText('End the game for everyone?');
  await page.getByTestId('end-game-yes').click();
}

/** The results popup is up over the lobby (the room's code under it). */
export async function expectResults(page: Page): Promise<void> {
  await expect(page.getByTestId('overlay-game-end')).toBeVisible();
  await expect(page.getByTestId('room-code')).toBeAttached();
}

/** Closes the results with Back to the room: the player is in the lobby, ready to play again. */
export async function closeResults(page: Page): Promise<void> {
  await page.getByTestId('results-done').click();
  await expect(page.getByTestId('overlay-game-end')).toHaveCount(0);
  await expect(page.getByTestId('room-code')).toBeVisible();
}

/**
 * The top bar says what is being played and keeps the room's code in view: the game's name, and
 * the code's four tiles (read-only, named for screen readers a letter at a time), on whatever
 * screen the page is at.
 */
export async function expectGameBar(page: Page, name: string, code: string): Promise<void> {
  await expect(page.locator('.gbar__name')).toHaveText(name);
  await expect(page.locator('.gbar__name')).toBeVisible();
  const tiles = page.getByTestId('game-code');
  await expect(tiles).toBeVisible();
  await expect(tiles).toHaveText(code);
  await expect(tiles).toHaveAttribute('aria-label', `Room code ${code.split('').join(' ')}`);
  await expect(tiles.locator('.room-card__char')).toHaveCount(code.length);
}

/**
 * The screens the game bar is checked on: the narrowest phones, a common phone, a tablet, a small
 * and a large desktop, and phones on their side (where Scribble's bar sits in a side column).
 */
export const BAR_SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
];

/**
 * The game's top bar fits on every screen in BAR_SIZES: nothing in it overflows the bar or the
 * screen, nothing on its first line or in its players row overlaps, every button in it is a 44px
 * target, the code's tiles are whole, the players row keeps at least one player's chip and cuts
 * none, a game's word stays inside its own room, and the status is whole: one line, or a status in parts
 * (StatusParts) stacked a part to a line, never cut. The game's name is whole; below
 * `nameMayCutBelow` (a line too full for a long name, The Spy Game's phone bar) it may give way,
 * the only thing that does, and only with an ellipsis. Back to the page's own size after.
 */
export async function gameBarFits(page: Page, { nameMayCutBelow = 0 }: { nameMayCutBelow?: number } = {}): Promise<void> {
  const own = page.viewportSize();
  for (const size of BAR_SIZES) {
    await page.setViewportSize(size);
    const problems = () =>
      page.evaluate((mayCut) => {
        const out: string[] = [];
        const bar = document.querySelector('.gbar');
        if (!bar) return ['no bar'];
        const b = bar.getBoundingClientRect();
        if (b.left < -0.5 || b.right > window.innerWidth + 0.5) out.push('the bar runs off the screen');
        if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
        const shown = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        for (const el of bar.querySelectorAll('*')) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          // A visually hidden label (a tablet's icon-alone buttons, a status's spoken separator) is a 1px box clipped to nothing.
          if (r.width <= 1 && r.height <= 1) continue;
          if (r.left < b.left - 0.5 || r.right > b.right + 0.5) out.push(`${el.getAttribute('data-testid') ?? el.getAttribute('class')} runs out of the bar`);
        }
        const row = bar.querySelector('.gbar__row');
        const parts = row ? [...row.children].filter(shown) : [];
        for (let i = 1; i < parts.length; i++) {
          const prev = parts[i - 1].getBoundingClientRect();
          const next = parts[i].getBoundingClientRect();
          if (prev.right > next.left + 0.5) out.push(`${parts[i - 1].className} overlaps ${parts[i].className}`);
        }
        for (const el of bar.querySelectorAll('button')) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 44 - 0.5 || r.width < 44 - 0.5) out.push(`${el.getAttribute('data-testid')} is ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const tiles = bar.querySelectorAll('[data-testid="game-code"] .room-card__char');
        if (tiles.length !== 4 || ![...tiles].every(shown)) out.push('the code is not four whole tiles');
        // The players row: nothing in it overlaps or runs past its own box (a word too long for its room), and the strip
        // keeps at least one player's chip, none of them cut.
        const people = bar.querySelector('.gbar__people');
        const below = people ? [...people.children].filter(shown) : [];
        for (let i = 0; i < below.length; i++) {
          if (below[i].scrollWidth > below[i].clientWidth + 1 && !below[i].matches('.gbar__status')) out.push(`${below[i].className} overflows`);
          if (i > 0 && below[i - 1].getBoundingClientRect().right > below[i].getBoundingClientRect().left + 0.5) out.push(`${below[i - 1].className} overlaps ${below[i].className}`);
        }
        const chips = bar.querySelector('.chips');
        if (chips && shown(chips)) {
          if (chips.scrollWidth > chips.clientWidth + 1) out.push('a player chip is cut');
          if (!chips.querySelector('[data-testid="player-chip"]')) out.push('no player chip shows');
        }
        // Cut text: its own laid-out width past its box (an ellipsis can hide a fraction of a pixel that scrollWidth rounds away).
        const cut = (el: Element) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.25;
        };
        const oneLine = (el: Element) => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 1.5;
        const name = bar.querySelector('.gbar__name');
        if (!name || !shown(name)) out.push('no name');
        else if (cut(name)) {
          if (window.innerWidth >= mayCut) out.push(`the name is cut at ${window.innerWidth}px`);
          if (getComputedStyle(name).textOverflow !== 'ellipsis') out.push('the name is clipped without an ellipsis');
        }
        const status = bar.querySelector('.gbar__status');
        if (status && shown(status)) {
          const pieces = [...status.querySelectorAll('.gbar__part')];
          if (pieces.length === 0 ? !oneLine(status) : pieces.some((piece) => !oneLine(piece))) out.push('the status wraps');
          if (cut(status) || pieces.some(cut)) out.push(`the status is cut at ${window.innerWidth}px`);
        }
        return out;
      }, nameMayCutBelow);
    await expect.poll(problems, { message: `the game bar fits at ${size.width}x${size.height}` }).toEqual([]);
  }
  if (own) await page.setViewportSize(own);
}
