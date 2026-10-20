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
let drawer: Player;
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

  let chosen: Player | undefined;
  await expect
    .poll(async () => {
      for (const p of players) if (await p.page.getByTestId('word-choice').first().isVisible()) chosen = p;
      return chosen?.name ?? null;
    })
    .not.toBeNull();
  if (!chosen) throw new Error('no drawer');
  drawer = chosen;
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

/** The screens a guesser's paper and fitted drawing are checked on; `keyboard` opens it (Android style). */
const SCREENS = [
  { width: 390, height: 844 },
  { width: 428, height: 753 },
  { width: 428, height: 417, keyboard: true },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

/**
 * How the drawing sits on a player's paper: the paper's size against its stage's, and the box of
 * the drawn pixels as fractions of the paper, with whatever lies over the paper (the caption, the
 * clock) that the drawing runs into.
 */
function paperOf(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="canvas"]');
    const stage = document.querySelector('.canvas-stage')?.getBoundingClientRect();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !stage || !ctx) return null;
    const r = canvas.getBoundingClientRect();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let left = Infinity;
    let top = Infinity;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4] < 128) {
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    const k = r.width / canvas.width;
    const drawn = { left: r.left + left * k, top: r.top + top * k, right: r.left + right * k, bottom: r.top + bottom * k };
    const over = [...document.querySelectorAll('.canvas-caption, [data-testid="game-header"] [data-testid="timer"]')]
      .map((el) => el.getBoundingClientRect())
      .filter((o) => o.width > 0 && o.left < drawn.right && o.right > drawn.left && o.top < drawn.bottom && o.bottom > drawn.top).length;
    const frame = document.querySelector('.canvas-frame')?.getBoundingClientRect();
    // The drawer's toolbar (and the gap above it) sits under the paper on the same stage.
    const group = document.querySelector('.canvas-group');
    const footer = document.querySelector('.canvas-group__footer');
    const below = group && footer ? footer.getBoundingClientRect().height + (parseFloat(getComputedStyle(group).rowGap) || 0) : 0;
    return {
      paper: { width: Math.round(r.width), height: Math.round(r.height) },
      // How much of the stage the paper (with its frame) leaves unused, each way.
      spare: frame ? { width: Math.round(stage.width - frame.width), height: Math.round(stage.height - below - frame.height) } : null,
      drawing: right < 0 ? null : { width: (right - left) / canvas.width, height: (bottom - top) / canvas.height, left: left / canvas.width, top: top / canvas.height },
      under: over,
    };
  });
}

test('a small drawing in a corner fills most of the guesser\'s paper, and the paper fills its stage on every screen', async () => {
  // The drawer sketches a small house in the top left corner, about a quarter of the canvas each way.
  const pen = drawer.page;
  const c = await box(pen.getByTestId('canvas'));
  const at = (fx: number, fy: number): [number, number] => [c.x + c.width * fx, c.y + c.height * fy];
  const lines = [
    [[0.05, 0.15], [0.25, 0.15], [0.25, 0.33], [0.05, 0.33], [0.05, 0.15]],
    [[0.04, 0.16], [0.15, 0.06], [0.26, 0.16]],
    [[0.13, 0.33], [0.13, 0.25], [0.17, 0.25], [0.17, 0.33]],
  ];
  for (const [first, ...rest] of lines) {
    await pen.mouse.move(...at(first[0], first[1]));
    await pen.mouse.down();
    for (const [fx, fy] of rest) await pen.mouse.move(...at(fx, fy), { steps: 6 });
    await pen.mouse.up();
  }

  // The drawer's own canvas never zooms: the house stays small, in its corner, on the whole 4:3 canvas.
  const own = await paperOf(pen);
  expect(own?.drawing, 'the drawer sees the house where it was drawn').toBeTruthy();
  if (own?.drawing) {
    expect(own.drawing.width, 'the drawer sees the house at its drawn size').toBeLessThan(0.3);
    expect(own.drawing.left).toBeLessThan(0.1);
  }
  expect(own && Math.abs(own.paper.width / own.paper.height - 4 / 3), 'the drawer keeps the 4:3 canvas').toBeLessThan(0.02);
  expect(own && own.spare && Math.min(own.spare.width, own.spare.height), 'the drawer\'s canvas is as large as its stage allows').toBeLessThanOrEqual(1);

  // Everyone watching: the paper takes the whole stage, the house fills most of it, clear of the caption and clock.
  const page = guesser.page;
  for (const size of SCREENS) {
    const { keyboard, ...viewport } = size;
    if (keyboard) await page.getByTestId('guess-tiles').click();
    await page.setViewportSize(viewport);
    await expect
      .poll(
        async () => {
          const p = await paperOf(page);
          if (!p || !p.spare || !p.drawing) return 'no drawing';
          if (p.spare.width > 1 || p.spare.height > 1) return `the paper leaves ${p.spare.width}x${p.spare.height}px of its stage`;
          if (p.drawing.width < 0.5 || p.drawing.height < 0.5) return `the drawing fills ${Math.round(p.drawing.width * 100)}% x ${Math.round(p.drawing.height * 100)}% of the ${p.paper.width}x${p.paper.height} paper`;
          if (p.under > 0) return 'the drawing runs under the caption or the clock';
          return 'fits';
        },
        { message: `the guesser's drawing at ${viewport.width}x${viewport.height}${keyboard ? ' with the keyboard open' : ''}` },
      )
      .toBe('fits');
    if (keyboard) await expect(page.locator('html')).toHaveClass(/is-keyboard/);
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
