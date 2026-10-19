import { expect, type Locator, type Page } from '@playwright/test';
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

/**
 * A confirm step says what it asks once: its question names the dialog and heads it, with no title
 * row over it saying the same, and the button under it is the action in a word or two ("Leave",
 * "End game"), so the action's verb reads twice at most, in the question and on the button.
 */
export async function expectConfirmReadsOnce(page: Page, question: string, button: Locator, action: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: question });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.sheet__title')).toHaveCount(0);
  await expect(button).toHaveText(action);
  const text = await dialog.innerText();
  expect(text.split(question).length - 1, `"${question}" once`).toBe(1);
  const verb = action.split(' ')[0];
  expect(text.match(new RegExp(`\\b${verb}\\b`, 'g'))?.length, `"${verb}" in the question and on the button only`).toBe(2);
}

/** Leaves from the lobby: the room bar's Leave, then Leave in the confirmation. */
export async function leaveLobby(page: Page): Promise<void> {
  await page.getByTestId('leave-room').click();
  await expectConfirmReadsOnce(page, 'Leave the room?', page.getByTestId('lobby-leave-yes'), 'Leave');
  await page.getByTestId('lobby-leave-yes').click();
}

/** Leaves from a game screen: the top bar's Leave (on a phone, Leave room in the options sheet), then Leave in the confirmation. */
export async function leaveGame(page: Page): Promise<void> {
  const menu = page.getByTestId('game-menu');
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId('leave-room').click();
  await expectConfirmReadsOnce(page, 'Leave the room?', page.getByTestId('game-leave-yes'), 'Leave');
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
  await expectConfirmReadsOnce(page, 'End the game for everyone?', page.getByTestId('end-game-yes'), 'End game');
  await page.getByTestId('end-game-yes').click();
}

/**
 * Every player in the room's list is in reach, and none is cut without a sign. The list shows every
 * row whole, the page scrolling to it if it must; or, where the window cannot hold the whole list with
 * Start under it (a big party), it scrolls inside in whole rows: its box ends on a faded peek of the
 * next row under a "+N more" pill naming the rows still below, and the box and Start (or a phone's
 * pinned footer) fit on the screen together: at the page's top wherever the room under the box holds
 * three rows, else once the page is scrolled to the list. Scrolled inside to its end, the last row
 * shows whole, the pill goes and the top fades. The list is left scrolled back to its top and the
 * page to its top.
 */
export async function expectPlayersInReach(page: Page, label: string): Promise<{ capped: boolean }> {
  const state = () =>
    page.evaluate(() => {
      const list = document.querySelector<HTMLElement>('[data-testid="player-list"]');
      if (!list) return null;
      const box = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll<HTMLElement>('[data-testid="player-item"]')].map((row) => row.getBoundingClientRect());
      const below = document.querySelector('[data-testid="lobby-actions"], [data-testid="lobby-footer"]')?.getBoundingClientRect() ?? null;
      const pinned = document.querySelector('[data-testid="lobby-footer"]') !== null;
      const pill = document.querySelector('[data-testid="player-list-more"]');
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        scrolls: list.scrollHeight > list.clientHeight + 1,
        rows: rows.map((r) => ({ top: r.top, bottom: r.bottom })),
        // What stays on the screen with the list: the gap and the block under it, or the pinned footer.
        under: below ? (pinned ? below.height : below.bottom - box.bottom) : 0,
        view: window.innerHeight,
        pill: pill ? (pill.textContent ?? '').trim() : null,
        pillBox: pill ? (() => { const r = pill.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })() : null,
        fade: list.closest('.lobby__list')?.getAttribute('data-fade') ?? '',
      };
    });
  // Once the page has caught up with a resize or a join (the list is measured on the resize and after every render).
  const settled = async () => {
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const a = await state();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
      const b = await state();
      if (a && b && a.height === b.height && a.scrolls === b.scrolls && a.pill === b.pill) return b;
    }
    return state();
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = await settled();
  if (!first) throw new Error(`${label}: no player list`);
  const n = first.rows.length;
  if (!first.scrolls) {
    // Every row whole inside the box, no pill and no fade.
    for (const [i, r] of first.rows.entries()) expect(r.bottom, `${label}: row ${i + 1} of ${n} inside the list`).toBeLessThanOrEqual(first.bottom + 0.5);
    expect(first.pill, `${label}: no "more" pill on a list that shows every row`).toBeNull();
    expect(first.fade, `${label}: no fade`).toBe('');
    // The page reaches the last row: scrolled to it, it shows whole, above a pinned footer.
    const last = await page.evaluate(() => {
      const row = () => [...document.querySelectorAll('[data-testid="player-item"]')].at(-1)!.getBoundingClientRect();
      const floor = () => Math.min(window.innerHeight, document.querySelector('[data-testid="lobby-footer"]')?.getBoundingClientRect().top ?? Infinity);
      window.scrollBy(0, row().bottom - (floor() - 8));
      const r = row();
      return { top: r.top, bottom: r.bottom, floor: floor() };
    });
    expect(last.top >= -0.5 && last.bottom <= last.floor + 0.5, `${label}: the page scrolls to the last player`).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    return { capped: false };
  }
  // Capped: whole rows, then the peek of exactly one more under the fade and the pill.
  const cut = first.rows.filter((r) => r.top < first.bottom - 0.5 && r.bottom > first.bottom + 0.5);
  expect(cut, `${label}: the box ends on the peek of one row`).toHaveLength(1);
  const peek = first.bottom - cut[0].top;
  expect(peek, `${label}: a peek, not half a row`).toBeGreaterThan(16);
  expect(peek, `${label}: a peek, not half a row`).toBeLessThan(32);
  const whole = first.rows.filter((r) => r.bottom <= first.bottom + 0.5).length;
  expect(whole, `${label}: at least three whole rows`).toBeGreaterThanOrEqual(3);
  expect(first.pill, `${label}: the pill names the rows still below`).toBe(`+${n - whole} more`);
  expect(n - whole, `${label}: a box never hides a single row`).toBeGreaterThanOrEqual(2);
  expect(first.fade, `${label}: the foot fades`).toBe('bottom');
  expect(first.pillBox && first.pillBox.top >= cut[0].top - 0.5 && first.pillBox.bottom <= first.bottom + 0.5, `${label}: the pill sits over the peek`).toBe(true);
  // The box and what stays under it fit the screen together, an edge to spare above and below.
  expect(first.height + first.under + 32, `${label}: the list and Start fit the screen together`).toBeLessThanOrEqual(first.view + 0.5);
  // At the page's top: where the room under the box's own top holds three whole rows and the peek, the box ends inside it, so
  // its pill and Start (or the pinned footer) show without a page scroll (a capped list once ran 200px under the fold at
  // 1366x768, Start and the pill with it); a list lower on the page (a laptop's browser, a phone) takes the window's room instead.
  const restRoom = first.view - first.top - first.under - 16;
  if (first.rows[2].bottom - first.top + 28 + 1 <= restRoom) {
    expect(first.bottom + first.under + 16, `${label}: the box, its pill and Start show at the page's top`).toBeLessThanOrEqual(first.view + 0.5);
    expect(first.pillBox && first.pillBox.bottom <= first.view + 0.5, `${label}: the pill is on the screen at the page's top`).toBe(true);
  }
  // Scrolled inside to its end: the last row whole, no pill, the top fades.
  await page.getByTestId('player-list').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(async () => (await state())?.pill ?? null, { message: `${label}: the pill goes at the end` }).toBeNull();
  const end = await state();
  if (!end) throw new Error(`${label}: no player list`);
  expect(end.rows[n - 1].bottom, `${label}: the last player shows whole`).toBeLessThanOrEqual(end.bottom + 0.5);
  expect(end.fade, `${label}: the top fades once scrolled`).toBe('top');
  await page.getByTestId('player-list').evaluate((el) => el.scrollTo(0, 0));
  await expect.poll(async () => (await state())?.fade ?? '').toBe('bottom');
  await page.evaluate(() => window.scrollTo(0, 0));
  return { capped: true };
}

/**
 * The open How to play card's text, line by line: no line ends on a hyphen ("mid-" / "game"), a
 * number ("4 points (3" / "on"), or the first half of a range ("2 to" / "5)."), and no line holds a
 * short word alone in text that runs to more lines. Each character's box gives its line.
 */
export async function rulesTextBreaks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('.rules__name, .rules__summary, .rules-fact__note, .rules-fact__label, .rules__text')) {
      const node = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE) as Text | undefined;
      if (!node) continue;
      const range = document.createRange();
      const lines: string[] = [];
      let top: number | null = null;
      let line = '';
      for (let i = 0; i < node.data.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rects = range.getClientRects();
        // A space where the line wraps has a box at each line's end: its first box says where it sits.
        if (rects.length > 0) {
          const t = Math.round(rects[0].top);
          if (top !== null && t > top + 2) {
            lines.push(line);
            line = '';
          }
          if (top === null || t > top + 2) top = t;
        }
        line += node.data[i];
      }
      lines.push(line);
      const clean = lines.map((l) => l.replace(/[\s\u00a0]+/g, ' ').trim());
      for (let i = 0; i < clean.length; i++) {
        const at = `${el.className} "${clean.join(' / ')}"`;
        if (i < clean.length - 1 && /[-\u2010\u2011]$/.test(clean[i])) out.push(`${at}: a line ends on a hyphen`);
        if (i < clean.length - 1 && /\d\)?$/.test(clean[i])) out.push(`${at}: a line ends on a number`);
        if (i < clean.length - 1 && /\d to$/.test(clean[i])) out.push(`${at}: a range splits`);
        const words = clean[i].split(' ').filter(Boolean);
        if (clean.length > 1 && words.length === 1 && words[0].replace(/[^\p{L}\p{N}]/gu, '').length < 8) out.push(`${at}: "${words[0]}" alone on a line`);
      }
    }
    return out;
  });
}

/** The How to play hero's badge (the lime pill at its corner) clear of the drawing's key shapes (data-key; the canvas is its ground, not one of them). */
export async function heroBadgeClear(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const badge = document.querySelector('.rules-hero__badge')?.getBoundingClientRect();
    if (!badge) return out;
    for (const part of document.querySelectorAll('.rules-hero__drawing > g:not(.rules-hero__shadow) [data-key]')) {
      const key = part.getAttribute('data-key');
      if (key === 'canvas') continue;
      const r = part.getBoundingClientRect();
      if (r.left < badge.right && badge.left < r.right && r.top < badge.bottom && badge.top < r.bottom) out.push(`the badge covers the ${key}`);
    }
    return out;
  });
}

/**
 * Opens How to play (a phone's sheet, a wider screen's card), checks it reads cleanly (no line ends on a
 * hyphen or a number, no word alone) with its badge clear of its picture, and closes it with Escape.
 */
export async function expectRulesReadCleanly(page: Page, name: string, label: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: `How to play ${name}` });
  await page.getByTestId('how-to-play').click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => rulesTextBreaks(page), { message: label }).toEqual([]);
  expect(await heroBadgeClear(page), label).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

/**
 * Opens the players sheet: the bar's players row or button, or, on a bar with neither (The Spy Game
 * on a phone, whose page lists the players), the players row of the options sheet.
 */
export async function openPlayers(page: Page): Promise<void> {
  const toggle = page.getByTestId('players-toggle');
  if (await toggle.isVisible()) return toggle.click();
  await page.getByTestId('game-menu').click();
  await page.getByTestId('menu-players').click();
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
 * The screens the game bar is checked on: the narrowest phones up to the widest (320 to 430), a
 * tablet, a small and a large desktop, and phones on their side (where Scribble's bar sits in a
 * side column), with two windows either side of the seam where a sideways bar's halves give way to
 * one line (the bar's content 481px, which on a phone's sideways page, 8px gutters and the bar's
 * own 8px padding and 1px border each side, is a 515px window: 505 is under the seam, 515 on it).
 * Portrait phones are listed narrowest first.
 */
export const BAR_SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
  { width: 515, height: 320 },
  { width: 505, height: 320 },
];

/**
 * The game's top bar fits on every screen in BAR_SIZES: nothing in it overflows the bar or the
 * screen, nothing on its first line or in its players row overlaps, every button in it is a 44px
 * target, the code's tiles are whole, the game's name reads whole, the options button ends its
 * line (a phone on its side too), a game's word stays inside its own room, and the status is
 * whole: one line, or a status in parts (StatusParts) stacked a part to a line, never cut. The
 * players row keeps at least one player's chip and cuts none: named chips only while every
 * player fits named (their status words whole), and a "+K" only with no room left for one more
 * face; a wider phone never shows fewer players than a narrower one. Back to the page's own size after.
 */
export async function gameBarFits(page: Page): Promise<void> {
  const own = page.viewportSize();
  const shownAt = new Map<number, number>();
  for (const size of BAR_SIZES) {
    await page.setViewportSize(size);
    const problems = () =>
      page.evaluate(() => {
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
          if (prev.bottom > next.top && prev.right > next.left + 0.5) out.push(`${parts[i - 1].className} overlaps ${parts[i].className}`);
        }
        for (const el of bar.querySelectorAll('button')) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 44 - 0.5 || r.width < 44 - 0.5) out.push(`${el.getAttribute('data-testid')} is ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        // The options button (a phone's) ends its line: nothing the bar shows on that line sits after it.
        const menu = bar.querySelector('[data-testid="game-menu"]');
        if (menu && shown(menu)) {
          const m = menu.getBoundingClientRect();
          for (const el of bar.querySelectorAll('.gbar__brand, .gbar__title, .gbar__code, .gbar__count, .gbar__clock, .chips, .gbar__middle')) {
            if (!shown(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom > m.top + 0.5 && r.top < m.bottom - 0.5 && r.right > m.left + 0.5) out.push(`${el.className} comes after the options button`);
          }
        }
        // The logo shows wherever the name (and the status under it) has room beside it; a one-row phone bar folds it only when
        // the name would otherwise be cut (the folded logo keeps its width out of the row, so the room it would take is known).
        const brand = bar.querySelector<HTMLElement>('.gbar__brand');
        const title = bar.querySelector<HTMLElement>('.gbar__title');
        if (!brand || !title) out.push('no logo');
        else if (brand.classList.contains('gbar__brand--folded')) {
          const laidOut = (el: Element) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return range.getBoundingClientRect().width;
          };
          const need = Math.max(0, ...[...title.children].map(laidOut));
          const gap = parseFloat(getComputedStyle(brand.parentElement as Element).columnGap) || 0;
          if (need + brand.offsetWidth + gap + 0.5 <= title.getBoundingClientRect().width) out.push(`the logo gave way with ${Math.round(title.getBoundingClientRect().width - need - brand.offsetWidth - gap)}px to spare for it`);
        } else if (!shown(brand)) out.push('the logo is hidden');
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
        const chips = bar.querySelector<HTMLElement>('.chips');
        if (chips && shown(chips)) {
          if (chips.scrollWidth > chips.clientWidth + 1) out.push('a player chip is cut');
          if (!chips.querySelector('[data-testid="player-chip"]')) out.push('no player chip shows');
          const css = getComputedStyle(chips);
          const more = chips.querySelector('[data-testid="chips-more"]');
          const slots = [...chips.children];
          if (chips.dataset.look === 'named') {
            // Named chips only while every player fits named; each status word whole.
            if (more) out.push('named chips beside a "+K"');
            for (const status of chips.querySelectorAll('.chip__status')) if (status.scrollWidth > status.clientWidth + 1) out.push(`the status "${status.textContent}" is cut`);
          }
          if (more) {
            // A "+K" never sits beside room for one more face (each at its least, with its gap: 40px and 4px unless the stylesheet says).
            const faceMin = parseFloat(css.getPropertyValue('--chip-face-min')) || 40;
            const faceGap = parseFloat(css.getPropertyValue('--chip-face-gap')) || 4;
            if ((slots.length + 1) * faceMin + slots.length * faceGap <= chips.clientWidth) out.push(`room for one more face beside "${more.textContent}"`);
          }
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
        else if (cut(name)) out.push(`the name is cut at ${window.innerWidth}px`);
        const status = bar.querySelector('.gbar__status');
        if (status && shown(status)) {
          const pieces = [...status.querySelectorAll('.gbar__part')];
          if (pieces.length === 0 ? !oneLine(status) : pieces.some((piece) => !oneLine(piece))) out.push('the status wraps');
          if (cut(status) || pieces.some(cut)) out.push(`the status is cut at ${window.innerWidth}px`);
        }
        return out;
      });
    await expect.poll(problems, { message: `the game bar fits at ${size.width}x${size.height}` }).toEqual([]);
    if (size.width < size.height && size.width <= 430) shownAt.set(size.width, await page.locator('.gbar [data-testid="player-chip"]').count());
  }
  // A wider phone never shows fewer players (a bar with chips: a card table's or The Spy Game's phone bar has none).
  const counts = [...shownAt.entries()].sort((a, c) => a[0] - c[0]);
  for (let i = 1; i < counts.length; i++) expect(counts[i][1], `players shown at ${counts[i][0]}px against ${counts[i - 1][0]}px`).toBeGreaterThanOrEqual(counts[i - 1][1]);
  if (own) await page.setViewportSize(own);
}

/**
 * The game's content lines up with its top bar at each of `sizes`: the first card under the bar
 * (`content`) starts and ends within 3px of the bar's own edges, as every game's does on a phone
 * and a tablet.
 */
export async function contentLinesUpWithBar(page: Page, content: string, sizes: { width: number; height: number }[]): Promise<void> {
  const own = page.viewportSize();
  for (const size of sizes) {
    await page.setViewportSize(size);
    const edges = () =>
      page.evaluate((selector) => {
        const bar = document.querySelector('.gbar')?.getBoundingClientRect();
        const card = document.querySelector(selector)?.getBoundingClientRect();
        if (!bar || !card) return 'missing';
        return { left: Math.round(Math.abs(card.left - bar.left)) <= 3, right: Math.round(Math.abs(card.right - bar.right)) <= 3 };
      }, content);
    await expect.poll(edges, { message: `${content} lines up with the bar at ${size.width}x${size.height}` }).toEqual({ left: true, right: true });
  }
  if (own) await page.setViewportSize(own);
}

/**
 * The screens a phone's options sheet is checked on: phones on their side (the shortest, where
 * the sheet's body has 261px at most) and upright.
 */
export const SHEET_SIZES = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

/**
 * The phone's options sheet holds every row at each of SHEET_SIZES: its body never scrolls, each
 * preference row and tall row (the players row, End game, Leave room) lies wholly inside the body
 * and on the screen, every tall row is a 44px target with its words on one line and whole, and the
 * close button is on the screen. Opens the sheet through the bar's options button and closes it
 * again; back to the page's own size after.
 */
export async function menuSheetFits(page: Page): Promise<void> {
  const own = page.viewportSize();
  for (const size of SHEET_SIZES) {
    await page.setViewportSize(size);
    await page.getByTestId('game-menu').click();
    await expect(page.getByTestId('menu-sheet')).toBeVisible();
    const problems = () =>
      page.evaluate(() => {
        const out: string[] = [];
        const sheet = document.querySelector('[data-testid="menu-sheet"]');
        const body = sheet?.querySelector<HTMLElement>('.sheet__body');
        if (!sheet || !body) return ['no sheet'];
        if (body.scrollHeight > body.clientHeight + 1) out.push(`the sheet scrolls (${body.scrollHeight}px in ${body.clientHeight}px)`);
        const b = body.getBoundingClientRect();
        const name = (el: Element) => el.getAttribute('data-testid') ?? el.className;
        const inside = (r: DOMRect, box: { top: number; bottom: number; left: number; right: number }) =>
          r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
        const screen = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
        for (const el of body.querySelectorAll('.pref-row, .exit-action')) {
          const r = el.getBoundingClientRect();
          if (!inside(r, b)) out.push(`${name(el)} is cut by the sheet's edge`);
          if (!inside(r, screen)) out.push(`${name(el)} is off the screen`);
          if (el.matches('.exit-action') && r.height < 44 - 0.5) out.push(`${name(el)} is ${Math.round(r.height)}px tall`);
          for (const text of el.querySelectorAll('strong, small')) {
            const line = parseFloat(getComputedStyle(text).lineHeight);
            if (text.scrollWidth > text.clientWidth + 1 || text.getBoundingClientRect().height > line * 1.5) out.push(`"${text.textContent}" wraps or is cut`);
          }
        }
        const close = sheet.querySelector('[data-testid="menu-sheet-close"]');
        if (!close || !inside(close.getBoundingClientRect(), screen)) out.push('the close button is off the screen');
        return out;
      });
    await expect.poll(problems, { message: `the options sheet fits at ${size.width}x${size.height}` }).toEqual([]);
    await page.getByTestId('menu-sheet-close').click();
    await expect(page.getByTestId('menu-sheet')).toHaveCount(0);
  }
  if (own) await page.setViewportSize(own);
}
