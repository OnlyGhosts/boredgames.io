import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, joinByCode, readyAll } from './party';

/**
 * A guesser on a phone: typing past and over revealed letters, and the keyboard never shrinking
 * the drawing. Two phones share a room of custom words with every hint on, so the first letter is
 * revealed 13 seconds into the turn. The tests build on each other and run serially.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
/** What a 336px keyboard leaves of a 390x844 phone and of a 428x753 one. */
const KEYBOARDS = [
  { closed: PORTRAIT, open: { width: 390, height: 508 } },
  { closed: { width: 428, height: 753 }, open: { width: 428, height: 417 } },
];
/** Ten letters each (so five hints), and never the same letter twice in a row. */
const WORDS = ['helicopter', 'motorcycle', 'skateboard', 'microphone', 'lighthouse', 'trampoline', 'dragonfly', 'chocolate', 'fireworks', 'lumberjack'];

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

let players: Player[] = [];
let guesser: Player;
let word = '';

async function newPhone(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  return { name, context, page: await context.newPage() };
}

function tiles(): Locator {
  return guesser.page.getByTestId('guess-tile');
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not laid out');
  return b;
}

/** iOS keeps the layout viewport and shrinks only the visual one for its keyboard; null closes it. */
async function iosKeyboard(page: Page, height: number | null): Promise<void> {
  await page.evaluate((h) => {
    const vv = window.visualViewport;
    if (!vv) throw new Error('no visualViewport');
    if (h === null) delete (vv as unknown as { height?: number }).height;
    else Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
    vv.dispatchEvent(new Event('resize'));
  }, height);
}

test.beforeAll(async ({ browser }) => {
  players = [await newPhone(browser, 'Hosty'), await newPhone(browser, 'Guesty')];
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('two phones start a game of long words with every hint, and the guesser starts typing', async () => {
  const [host, guest] = players;
  const code = await createParty(host.page, host.name);
  await joinByCode(guest.page, guest.name, code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await host.page.getByTestId('settings-rounds').fill('1');
  await host.page.getByTestId('settings-hints').fill('5');
  const words = host.page.getByTestId('settings-customWords');
  await words.fill(WORDS.join('\n'));
  await words.blur();
  await expect(host.page.getByTestId('settings-customWords-count')).toHaveText(`${WORDS.length} words`);
  await host.page.getByTestId('settings-row-customWordsOnly').click();
  await readyAll([guest.page]);
  await host.page.getByTestId('start-game').click();

  let drawer: Player | undefined;
  await expect
    .poll(async () => {
      for (const p of players) if (await p.page.getByTestId('word-choice').first().isVisible()) drawer = p;
      return drawer?.name ?? null;
    })
    .not.toBeNull();
  if (!drawer) throw new Error('no drawer');
  await drawer.page.getByTestId('word-choice').first().click();
  word = ((await drawer.page.getByTestId('word-plain').locator('.word__text').textContent()) ?? '').trim();
  expect(WORDS).toContain(word);
  guesser = players.find((p) => p !== drawer) as Player;

  // Four wrong letters typed before any hint: a letter revealed under them later must not move them.
  await guesser.page.getByTestId('guess-tiles').click();
  await guesser.page.getByTestId('guess-input').pressSequentially('zzzz');
  await expect(guesser.page.locator('.gtile--hint')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await expect(tiles().nth(i)).toHaveAttribute('data-char', 'z');
});

test('with the keyboard open the drawing keeps its full size and the guess bar sits above the keyboard', async () => {
  const page = guesser.page;
  const canvas = page.getByTestId('canvas');
  const bar = page.getByTestId('guess-form');
  await expect(page.getByTestId('guess-input')).toBeFocused();
  for (const { closed, open } of KEYBOARDS) {
    await page.setViewportSize(closed);
    await expect.poll(async () => (await box(bar)).y + (await box(bar)).height, { message: `guess bar at ${closed.width}x${closed.height}` }).toBeLessThanOrEqual(closed.height);
    const full = await box(canvas);
    expect(full.width, 'the canvas spans the phone').toBeGreaterThanOrEqual(closed.width - 20);

    for (const kind of ['android', 'ios'] as const) {
      const label = `${kind} keyboard at ${closed.width}x${closed.height}`;
      // Android (interactive-widget=resizes-content) shrinks the page; iOS only the visual viewport.
      if (kind === 'android') await page.setViewportSize(open);
      else await iosKeyboard(page, open.height);
      await expect.poll(async () => (await box(bar)).y + (await box(bar)).height, { message: `guess bar above the ${label}` }).toBeLessThanOrEqual(open.height);
      const typing = await box(canvas);
      expect(Math.abs(typing.width - full.width), `canvas width with the ${label}`).toBeLessThanOrEqual(1);
      expect(Math.abs(typing.height - full.height), `canvas height with the ${label}`).toBeLessThanOrEqual(1);
      expect(typing.y, `canvas on screen with the ${label}`).toBeGreaterThanOrEqual(0);
      expect((await box(bar)).y, `the guess bar under the canvas with the ${label}`).toBeGreaterThanOrEqual(typing.y + typing.height);
      // The header steps aside; its clock stays, over the canvas's top right corner.
      const clock = await box(page.getByTestId('game-header').getByTestId('timer'));
      expect(clock.y, `clock inside the canvas with the ${label}`).toBeGreaterThanOrEqual(typing.y);
      expect(clock.x + clock.width, `clock inside the canvas with the ${label}`).toBeLessThanOrEqual(typing.x + typing.width);
      await expect(page.getByTestId('game-menu')).toBeHidden();
      await expect(page.getByTestId('guess-input')).toBeFocused();
      if (kind === 'android') await page.setViewportSize(closed);
      else await iosKeyboard(page, null);
      await expect(page.getByTestId('game-menu')).toBeVisible();
    }
  }
  await page.setViewportSize(PORTRAIT);
});

test('a revealed letter is part of the word: typed past, typed over, backspaced across and sent', async () => {
  const page = guesser.page;
  const input = page.getByTestId('guess-input');
  const hint = page.locator('[data-testid="guess-tile"].gtile--hint').first();
  await expect(hint).toBeVisible({ timeout: 20_000 });
  const at = await tiles().evaluateAll((els) => els.findIndex((el) => el.classList.contains('gtile--hint')));
  expect(at).toBeGreaterThanOrEqual(0);
  // The letters typed before the reveal stayed in their tiles.
  for (let i = 0; i < 4; i++) await expect(tiles().nth(i)).toHaveAttribute('data-char', 'z');

  // Up to the revealed letter: the caret rests on it.
  await input.fill('');
  await input.pressSequentially(word.slice(0, at));
  await expect(tiles().nth(at)).toHaveClass(/gtile--active/);
  if (at < word.length - 1) {
    // Another letter leaves it in place and lands after it; Backspace steps back onto it.
    await input.pressSequentially(word[at + 1]);
    await expect(tiles().nth(at + 1)).toHaveAttribute('data-char', word[at + 1]);
    await expect(tiles().nth(at)).not.toHaveClass(/gtile--mismatch/);
    await expect(tiles().nth(at)).toHaveText(new RegExp(`^${word[at]}$`, 'i'));
    await input.press('Backspace');
    await expect(tiles().nth(at)).toHaveClass(/gtile--active/);
    await expect(tiles().nth(at + 1)).toHaveAttribute('data-char', '');
  }
  // Typing it over leaves the same word; the caret moves on.
  await input.pressSequentially(word[at]);
  await expect(tiles().nth(at)).toHaveAttribute('data-char', word[at]);
  await expect(tiles().nth(at)).toHaveClass(/gtile--match/);
  await input.press('Backspace');

  // The rest typed without the revealed letter: the tiles read the whole word and the guess is right.
  await input.pressSequentially(word.slice(at + 1));
  await expect(page.locator('[data-testid="guess-tile"][data-filled="true"]')).toHaveCount(word.length - 1);
  await expect(page.locator('[data-testid="guess-tile"].gtile--mismatch')).toHaveCount(0);
  await input.press('Enter');
  await expect(page.locator('[data-testid="feed-line"][data-kind="correct"]').first()).toBeVisible();
  await expect(page.getByTestId('guess-input')).toHaveCount(0);
});
