import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { closeResults, createParty, expectReadyCount, joinByCode, readyAll } from './party';
import { tableBots, type TableBot } from './tableBots';
import { cornersClear, myAreaOnScreen, seatFloors, tilesReadable } from './tableFit';

/**
 * Texas Hold'em on the Stake-style table, between a desktop host and two phones (390x844, touch):
 * the stacks, the blinds and two hands set in the lobby; a hand played through the control panel
 * (1/2 pot, Pot, MAX, a typed raise sent with Enter, a call, a fold, checks down) with only the
 * acting page's moves lit, the board coming out street by street, a showdown on the table (no
 * results screen) with the pot paid to the winner; a hand folded round to one player with no cards
 * shown; the results ranked by chips; and a second game with the desktop shortcuts, the panel at
 * 320x568 and the host's End game. Every step checks that each page's hole cards appear on that
 * page only until a showdown shows them, and that the chips equal the platform score. The deck is
 * really shuffled, so the checks hold whatever is dealt. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const PORTRAIT = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const MIN_TARGET = 44;
const STARTING_CHIPS = 500;
const SMALL_BLIND = 10;
const TOTAL_CHIPS = STARTING_CHIPS * 3;

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
let roomCode = '';

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

const phones = (): Player[] => players.filter((p) => p !== host);
const screen = (p: Player): Locator => p.page.getByTestId('poker-screen');
const byName = (name: string): Player => {
  const p = players.find((q) => q.name === name);
  if (!p) throw new Error(`no player ${name}`);
  return p;
};

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

/** The phone layout holds: no sideways scroll, the whole panel on screen, every control a 44px target, the field 16px, my cards' ranks and suits whole. */
async function phoneLayoutHolds(p: Player, size: { width: number; height: number }): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(size.width);
  const panel = await boxOf(p.page.getByTestId('pk-panel'));
  expect(panel.y, `${p.name}: the panel starts on screen`).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height, `${p.name}: the panel ends on screen`).toBeLessThanOrEqual(size.height + 0.5);
  expect(panel.x + panel.width).toBeLessThanOrEqual(size.width + 0.5);
  // Off my turn while I am in the hand, the moves are picks for my turn in the same places.
  const picking = (await p.page.getByTestId('premove-checkFold').count()) > 0;
  const has = async (id: string) => (await p.page.getByTestId(id).count()) > 0;
  const call = picking ? ((await has('premove-call')) ? 'premove-call' : 'premove-check') : (await has('action-call')) ? 'action-call' : 'action-check';
  const moves = picking ? ['premove-checkFold', 'premove-callAny'] : ['action-fold', 'action-allin'];
  for (const id of ['raise-input', 'raise-half', 'raise-pot', 'raise-max', ...moves, call, 'action-raise', 'players-toggle', 'game-menu']) {
    const box = await boxOf(p.page.getByTestId(id));
    expect(box.height, `${p.name}: ${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box.y + box.height, `${p.name}: ${id} is on screen`).toBeLessThanOrEqual(size.height + 0.5);
  }
  expect(await p.page.getByTestId('raise-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'the raise field is 16px so iOS does not zoom').toBeGreaterThanOrEqual(16);
  // My cards and the board are on screen too.
  expect((await boxOf(p.page.getByTestId('my-area'))).y).toBeGreaterThan(0);
  expect((await boxOf(p.page.getByTestId('board'))).y).toBeGreaterThan(0);
  // Nothing scrolls, either way: the document, the table, the players.
  const scrolls = () =>
    p.page.evaluate(() =>
      ['html', '[data-testid="poker-main"]', '[data-testid="pk-table"]', '[data-testid="seats"]', '[data-testid="hand-indicator"]'].filter((sel) => {
        const el = document.querySelector(sel);
        return el !== null && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
      }),
    );
  // Nor is the hand under the name ever cut short.
  await expect.poll(scrolls, { message: `${p.name}: nothing scrolls or is cut short` }).toEqual([]);
  // Every rank and suit of my cards reads whole: nothing over their corners (the hand's name, my bet, the dealer button).
  await cornersClear(p.page, p.name);
}

/** Starts recording, every frame, the stacks on `page` (my balance, each seat's figure and its data-chips) and whether a hand's outcome shows. */
async function watchStacks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { stackFrames?: { outcome: boolean; stacks: Record<string, number> }[] };
    w.stackFrames = [];
    const tick = () => {
      const stacks: Record<string, number> = {};
      const mine = document.querySelector('[data-testid="my-chips"]');
      if (mine) stacks.mine = Number(mine.getAttribute('data-chips'));
      for (const seat of Array.from(document.querySelectorAll('[data-testid="seat"]'))) {
        const name = seat.getAttribute('data-name') ?? '?';
        stacks[`${name} data`] = Number(seat.getAttribute('data-chips'));
        const figure = seat.querySelector('[data-testid="seat-chips"]')?.getAttribute('data-chips');
        if (figure) stacks[`${name} figure`] = Number(figure);
      }
      const outcome = document.querySelector('[data-testid="my-area"][data-outcome], [data-testid="seat"][data-outcome]') !== null;
      w.stackFrames?.push({ outcome, stacks });
      if (!outcome) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Every recorded frame before the outcome showed: no stack went up (the pot is paid only once the outcome is on screen). */
async function noStackRoseEarly(page: Page, name: string): Promise<void> {
  const frames = await page.evaluate(() => (window as Window & { stackFrames?: { outcome: boolean; stacks: Record<string, number> }[] }).stackFrames ?? []);
  expect(frames.some((f) => f.outcome), `${name}: the outcome showed`).toBe(true);
  const before = frames.slice(0, frames.findIndex((f) => f.outcome));
  expect(before.length, `${name}: frames before the outcome`).toBeGreaterThan(0);
  for (let i = 1; i < before.length; i++) {
    for (const [key, value] of Object.entries(before[i].stacks)) {
      const was = before[i - 1].stacks[key];
      if (was !== undefined) expect(value, `${name}: ${key} before the outcome showed`).toBeLessThanOrEqual(was);
    }
  }
}

async function chipsOf(p: Player): Promise<number> {
  return Number((await p.page.getByTestId('my-chips').getAttribute('data-chips')) ?? 'NaN');
}

/** Every player's platform score, read from the host's players sheet. */
async function scoresOnHost(): Promise<Record<string, number>> {
  await host.page.getByTestId('players-toggle').click();
  const sheet = host.page.getByTestId('players-sheet');
  await expect(sheet.getByTestId('player-item')).toHaveCount(players.length);
  const scores: Record<string, number> = {};
  for (const p of players) scores[p.name] = Number((await sheet.locator(`[data-testid="player-item"][data-name="${p.name}"]`).getAttribute('data-score')) ?? 'NaN');
  await host.page.getByTestId('players-sheet-close').click();
  await expect(sheet).toHaveCount(0);
  return scores;
}

/** The platform score is the chip count, for every player. */
async function scoresMatchChips(): Promise<void> {
  // The stacks on show reach the truth once the payout has landed: the score is the truth.
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-busy', 'false', { timeout: 10_000 });
  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  await expect.poll(scoresOnHost, { message: 'score == chips' }).toEqual(chips);
}

/** Chips on the table: every stack plus the pot. Nothing is created or lost. */
async function chipsConserved(): Promise<void> {
  await expect
    .poll(async () => {
      let sum = Number((await host.page.getByTestId('pot').getAttribute('data-chips')) ?? 'NaN');
      for (const p of players) sum += await chipsOf(p);
      return sum;
    })
    .toBe(TOTAL_CHIPS);
}

const cardsOf = (locator: Locator): Promise<string[]> => locator.evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.rank}${(el as HTMLElement).dataset.suit}`));
const cardLocator = (page: Page, card: string): Locator => page.locator(`[data-rank="${card.slice(0, -1)}"][data-suit="${card.slice(-1)}"]`);

/** Every page has played out its animations: the cards on show are the hand in play. */
async function tableAtRest(): Promise<void> {
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-busy', 'false');
}

/**
 * Every page holds two cards of its own, face up, and none of them shows anywhere on another page:
 * the seats show backs without a rank and the board never names them.
 */
async function holeCardsStayPrivate(): Promise<Record<string, string[]>> {
  await tableAtRest();
  const hands: Record<string, string[]> = {};
  for (const p of players) {
    await expect(p.page.locator('[data-testid="my-card"][data-face="up"]')).toHaveCount(2);
    hands[p.name] = await cardsOf(p.page.getByTestId('my-card'));
    await expect(p.page.locator('[data-testid="seat-card"][data-rank]')).toHaveCount(0);
  }
  for (const p of players) {
    for (const q of players) {
      if (q === p) continue;
      for (const card of hands[q.name]) await expect(cardLocator(p.page, card), `${q.name}'s ${card} on ${p.name}'s page`).toHaveCount(0);
    }
  }
  return hands;
}

/** Whose move it is (the host's table and the actor's own page agree, and the actor's moves are lit), or null once the hand is over. */
async function actor(): Promise<Player | null> {
  let found: Player | null = null;
  await expect
    .poll(
      async () => {
        if ((await screen(host).getAttribute('data-phase')) !== 'acting') return 'over';
        const turn = await screen(host).getAttribute('data-turn-player');
        const step = await stepOn(host);
        for (const p of players) {
          const area = p.page.getByTestId('my-area');
          // The actor's own page must have caught up with the same step: a stale page still shows the move just made.
          if ((await area.getAttribute('data-player-id')) === turn && (await stepOn(p)) === step && (await area.getAttribute('data-my-turn')) === 'true' && (await p.page.locator('[data-testid="action-fold"]:enabled').count()) > 0) {
            found = p;
            return p.name;
          }
        }
        return null;
      },
      { message: 'a player whose move it is, or the end of the hand', timeout: 15_000 },
    )
    .not.toBeNull();
  return found;
}

/** A page's step: the hand, the street and whose move it is (a move always changes one of them). */
async function stepOn(p: Player): Promise<string> {
  const s = screen(p);
  return `${await s.getAttribute('data-hand')}:${await s.getAttribute('data-phase')}:${await s.getAttribute('data-street')}:${await s.getAttribute('data-turn-player')}`;
}

const stepOnHost = (): Promise<string> => stepOn(host);

/** Only the actor's moves are lit; every other page has the whole panel dimmed and names the actor. */
async function onlyActorCanMove(acting: Player): Promise<void> {
  for (const p of players) {
    if (p === acting) {
      await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText('Your turn');
      continue;
    }
    await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText(`${acting.name}’s turn`);
    // A page still in the hand may pick a move for its turn (aria-pressed); nothing plays now.
    await expect(p.page.locator('[data-testid="pk-panel"] button:not([disabled]):not([aria-pressed])')).toHaveCount(0);
    await expect(p.page.locator(`[data-testid="seat"][data-name="${acting.name}"]`)).toHaveAttribute('data-turn', 'true');
  }
  await expect(acting.page.getByTestId('action-fold')).toBeEnabled();
}

/** Plays one move and waits for the table to take it. */
async function move(acting: Player, id: 'action-fold' | 'action-call' | 'action-check'): Promise<void> {
  const before = await stepOnHost();
  await acting.page.getByTestId(id).click();
  await expect.poll(stepOnHost).not.toBe(before);
}

/** Calls or checks round until the hand is over; checks privacy on every move and that the board comes out three, then one, then one. */
async function callDown(): Promise<number[]> {
  const boards: number[] = [];
  for (let moves = 0; moves < 20; moves++) {
    const acting = await actor();
    if (!acting) return boards;
    await holeCardsStayPrivate();
    await onlyActorCanMove(acting);
    const board = await host.page.locator('[data-testid="community-card"][data-face="up"]').count();
    if (boards[boards.length - 1] !== board) boards.push(board);
    await move(acting, (await acting.page.getByTestId('action-call').count()) > 0 ? 'action-call' : 'action-check');
  }
  throw new Error('the hand did not reach its end');
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana', { viewport: { width: 1440, height: 900 } });
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host sets the stacks, the blinds and two hands, two phones join and the first hand is dealt', async () => {
  roomCode = await createParty(host.page, host.name, 'poker');
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="poker"]')).toHaveAttribute('aria-checked', 'true');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId(`settings-startingChips-${STARTING_CHIPS}`).click();
  await expect(host.page.getByTestId(`settings-startingChips-${STARTING_CHIPS}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(host.page.getByTestId('settings-startingChips')).toHaveValue(String(STARTING_CHIPS));
  await host.page.getByTestId(`settings-smallBlind-${SMALL_BLIND}`).click();
  await expect(host.page.getByTestId(`settings-smallBlind-${SMALL_BLIND}`)).toHaveAttribute('aria-pressed', 'true');
  // The sliders' tracks line up and keep their length as the value changes (the thumb never jumps).
  const trackWidths = () => Promise.all(['hands', 'blindsIncreaseEvery'].map(async (id) => (await host.page.getByTestId(`settings-${id}`).boundingBox())?.width ?? 0));
  await expect(host.page.getByTestId('settings-value-hands')).toHaveText('No limit');
  const before = await trackWidths();
  expect(before[0]).toBeGreaterThan(0);
  expect(before[1]).toBe(before[0]);
  await host.page.getByTestId('settings-hands').fill('2');
  await expect(host.page.getByTestId('settings-value-hands')).toHaveText('2');
  expect(await trackWidths()).toEqual(before);
  // No clocks to set: the turn and the results pause are fixed.
  for (const id of ['actSeconds', 'resultsSeconds']) await expect(host.page.getByTestId(`settings-${id}`)).toHaveCount(0);
  for (const p of phones()) await expect(p.page.getByTestId('settings-panel')).toHaveCount(0);

  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'acting');
    await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-hand', '1');
    await expect(p.page.getByTestId('hand-indicator')).toContainText('Hand 1 of 2');
    await expect(p.page.getByTestId('blinds')).toHaveAttribute('data-big', String(SMALL_BLIND * 2));
    // No band across the table: the line under the ribbon says whose turn it is, with the turn clock.
    await expect(p.page.getByTestId('table-turn').getByTestId('timer')).toBeVisible();
    await expect(p.page.getByTestId('spotlight')).toHaveCount(0);
    await expect(p.page.getByTestId('board')).toHaveAttribute('data-street', 'preflop');
    await expect(p.page.getByTestId('community-slot')).toHaveCount(5);
    await expect(p.page.getByTestId('seat')).toHaveCount(2);
    await expect(p.page.getByTestId('table-ribbon')).toContainText(`Blinds ${SMALL_BLIND}/${SMALL_BLIND * 2}`);
    await expect(p.page.getByTestId('table-ribbon')).toContainText('Hand 1 of 2');
    // The hand, the blinds and the street are on the table, not in the top bar.
    await expect(p.page.getByTestId('phase-kicker')).toHaveText('Pre-flop');
    await expect(p.page.getByTestId('poker-header')).not.toContainText('Hand');
    await expect(p.page.getByTestId('poker-header')).not.toContainText('Blinds');
    // Every stack reads as its figure on the tile's footer, every bet as "bet N" beside it: never two bare numbers side by side.
    for (const chips of await p.page.getByTestId('seat-chips').allTextContents()) expect(chips).toMatch(/^[\d,.kM]+$/);
    // A seat's bet shows once its blind's chips have landed (they fly in after the deal): wait for one on every seat that posted a blind ("SB 10", "BB 20") before reading them.
    const blindSeats = p.page.getByTestId('seat').filter({ has: p.page.getByTestId('seat-line').filter({ hasText: /^(SB|BB) / }) });
    const bets = p.page.getByTestId('seat-bet').filter({ hasText: /^bet / });
    await expect
      .poll(async () => {
        const blinds = await blindSeats.count();
        return blinds > 0 && (await bets.count()) === blinds && (await blindSeats.getByTestId('seat-bet').filter({ hasText: /^bet / }).count()) === blinds;
      }, { message: `${p.name}: a bet on every seat that posted a blind, and on no other` })
      .toBe(true);
    for (const text of await bets.allTextContents()) expect(text).toMatch(/^bet [\d,.kM]+$/);
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
  }
  // The dealer button sits on exactly one seat on every page.
  for (const p of players) await expect(p.page.locator('[data-testid="seat-dealer"], [data-testid="my-dealer"]')).toHaveCount(1);
  await expect(host.page.getByTestId('pot')).toHaveAttribute('data-chips', String(SMALL_BLIND * 3));
  // No status line or shortcut hint in any panel.
  for (const p of players) await expect(p.page.locator('[data-testid="hotkey-hint"], [data-testid="turn-status"]')).toHaveCount(0);
  await holeCardsStayPrivate();
  await scoresMatchChips();
  await chipsConserved();
});

/** My two cards' width on the stage and the board's card width, as `page` draws them. */
const cardWidths = (page: Page): Promise<{ mine: number; board: number }> =>
  page.evaluate(() => {
    const table = document.querySelector('[data-testid="pk-table"]');
    return {
      mine: Math.round((document.querySelector('[data-testid="my-cards"] .playing-card')?.getBoundingClientRect().width ?? 0) * 10) / 10,
      board: table ? Math.round(parseFloat(getComputedStyle(table).getPropertyValue('--pk-card-w')) * 10) / 10 : 0,
    };
  });

test('hand one: a raise through the panel, a call and a fold, the board street by street, and a showdown on the table with the pot to the winner', async () => {
  for (const p of phones()) await phoneLayoutHolds(p, PORTRAIT);
  // Three at the table on a 390x844 phone: my two cards take the room the two seats leave, half as wide again as the board's
  // (they were the board's 49px, five cards and the deck across keeping them small).
  for (const p of phones()) {
    await expect.poll(async () => { const w = await cardWidths(p.page); return w.mine / w.board; }, { message: `${p.name}: my cards half as wide again as the board's` }).toBeGreaterThan(1.45);
  }
  for (const p of phones()) await expect(p.page.getByTestId('hand-hint')).toHaveText(/^(Pair of .+|.+ high)$/);

  const raiser = await actor();
  if (!raiser) throw new Error('nobody to act');
  await onlyActorCanMove(raiser);
  const panel = raiser.page.getByTestId('pk-panel');
  await expect(panel).toHaveAttribute('data-kind', 'raise');
  const min = Number(await panel.getAttribute('data-min'));
  const max = Number(await panel.getAttribute('data-max'));
  expect(min).toBe(SMALL_BLIND * 4);
  // The field starts at the minimum raise; the buttons walk it.
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue(String(min));
  await expect(raiser.page.getByTestId('action-raise')).toHaveText('Raise');
  await expect(raiser.page.getByTestId('action-raise')).toHaveAttribute('aria-label', `Raise to ${min}`);
  await raiser.page.getByTestId('raise-max').click();
  await expect(panel).toHaveAttribute('data-amount', String(max));
  await raiser.page.getByTestId('raise-pot').click();
  const pot = Number(await panel.getAttribute('data-amount'));
  expect(pot).toBeGreaterThan(min);
  await raiser.page.getByTestId('raise-half').click();
  expect(Number(await panel.getAttribute('data-amount'))).toBeLessThan(pot);
  // Under the window snaps back to the minimum; the clear button empties the field and the raise waits for an amount.
  await raiser.page.getByTestId('raise-input').fill('3');
  await raiser.page.getByTestId('raise-input').blur();
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue(String(min));
  await raiser.page.getByTestId('raise-clear').click();
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue('');
  await expect(raiser.page.getByTestId('action-raise')).toBeDisabled();
  // A typed amount, sent with Enter (the phone keyboard's Go).
  const to = min + 30;
  await raiser.page.getByTestId('raise-input').fill(String(to));
  await expect(raiser.page.getByTestId('action-raise')).toHaveAttribute('aria-label', `Raise to ${to}`);
  const before = await stepOnHost();
  await raiser.page.getByTestId('raise-input').press('Enter');
  await expect.poll(stepOnHost).not.toBe(before);
  const watcher = raiser === host ? pia : host;
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"]`)).toHaveAttribute('data-bet', String(to));
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"] [data-testid="seat-line"]`)).toHaveText(`Raise to ${to}`);
  // The raise is said under the ribbon too, and on the raiser's seat as a bet, apart from the stack.
  await expect(watcher.page.getByTestId('turn-sub')).toHaveText(`${raiser.name} raises to ${to}`);
  await expect(raiser.page.getByTestId('turn-sub')).toHaveText(`You raise to ${to}`);
  const raiserBet = watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"] [data-testid="seat-bet"]`);
  await expect(raiserBet).toHaveAttribute('data-bet', String(to));
  await expect(raiserBet).toHaveText(`bet ${to.toLocaleString('en-US')}`);
  await chipsConserved();

  // The next player calls, the one after folds: a two-way pot goes to the flop.
  const caller = await actor();
  if (!caller) throw new Error('the hand ended early');
  await onlyActorCanMove(caller);
  await expect(caller.page.getByTestId('action-call')).toHaveText(/^Call \d+$/);
  await move(caller, 'action-call');
  const folder = await actor();
  if (!folder) throw new Error('the hand ended early');
  await move(folder, 'action-fold');
  await expect(folder.page.getByTestId('my-area')).toHaveAttribute('data-status', 'folded');
  for (const p of players) {
    if (p === folder) continue;
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"]`)).toHaveAttribute('data-status', 'folded');
    // The folded hand went to the muck.
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"] [data-testid="seat-card"]`)).toHaveCount(0);
    // Its tile says so where the cards were: two empty places, beside its stack (and its bet, if it had one this street).
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"] [data-testid="seat-cards"].tbl-tile__cards--folded .tbl-tile__slot`)).toHaveCount(2);
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"] [data-testid="seat-chips"]`)).toBeVisible();
  }
  for (const p of players) await expect(p.page.locator('[data-testid="community-card"][data-face="up"]')).toHaveCount(3);
  await chipsConserved();

  // From here to the showdown, every page records every frame's stacks (my balance and each seat's) and whether an outcome shows yet.
  for (const p of players) await watchStacks(p.page);
  const boards = await callDown();
  // The board came out street by street: the flop, then the turn, then the river.
  expect(boards).toEqual([3, 4, 5]);

  // The showdown stays on the table: no results screen, both contenders' cards shown on every page, the folded hand never.
  const contenders = players.filter((p) => p !== folder);
  const own: Record<string, string[]> = {};
  for (const p of contenders) own[p.name] = (await cardsOf(p.page.getByTestId('my-card'))).sort();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'results');
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
    await expect(p.page.locator('[data-testid="community-card"][data-face="up"]')).toHaveCount(5);
    await expect(p.page.getByTestId('table-turn')).toHaveAttribute('data-state', 'result');
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"] [data-testid="seat-card"]`)).toHaveCount(0);
    for (const q of contenders) {
      if (q === p) continue;
      const shown = p.page.locator(`[data-testid="seat"][data-name="${q.name}"] [data-testid="seat-card"][data-face="up"]`);
      await expect(shown).toHaveCount(2);
      expect((await cardsOf(shown)).sort(), `${q.name}'s cards on ${p.name}'s page`).toEqual(own[q.name]);
    }
  }
  // The pot went to the winner(s): every page agrees on who, the payouts add up to the pot, and the stacks show it.
  const paid: Record<string, number> = {};
  const myOutcome = await host.page.getByTestId('my-area').getAttribute('data-outcome');
  if (myOutcome === 'win') paid[host.name] = Number(await host.page.getByTestId('my-area').getAttribute('data-payout'));
  for (const q of phones()) {
    const seat = host.page.locator(`[data-testid="seat"][data-name="${q.name}"]`);
    if ((await seat.getAttribute('data-outcome')) === 'win') paid[q.name] = Number(await seat.getAttribute('data-payout'));
  }
  expect(Object.keys(paid).length).toBeGreaterThan(0);
  const total = Object.values(paid).reduce((a, b) => a + b, 0);
  // The stacks on show reach the truth once the payout has landed.
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-busy', 'false', { timeout: 10_000 });
  const committed: Record<string, number> = {};
  for (const p of players) committed[p.name] = STARTING_CHIPS - (await chipsOf(p)) + (paid[p.name] ?? 0);
  expect(total).toBe(Object.values(committed).reduce((a, b) => a + b, 0));
  for (const [name, amount] of Object.entries(paid)) {
    await expect(byName(name).page.getByTestId('my-area')).toHaveAttribute('data-outcome', 'win');
    await expect(byName(name).page.getByTestId('my-area')).toHaveAttribute('data-payout', String(amount));
  }
  for (const p of phones()) await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText(Object.keys(paid).length > 1 ? /^Split pot/ : /(wins|win) \d+/);
  // No stack rose before the showdown's outcome was on that page: until then chips only go out, to bets.
  for (const p of players) await noStackRoseEarly(p.page, p.name);
  await chipsConserved();
  await scoresMatchChips();

  // After the results pause the next hand deals on its own.
  for (const p of players) await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-hand', '2', { timeout: 20_000 });
});

test('hand two: two folds hand the pot over with no cards shown, and the last hand ends with the results ranked by chips', async () => {
  await holeCardsStayPrivate();
  await chipsConserved();
  const folders: Player[] = [];
  for (let i = 0; i < 2; i++) {
    const acting = await actor();
    if (!acting) throw new Error('the hand ended before two folds');
    await onlyActorCanMove(acting);
    await move(acting, 'action-fold');
    await expect(acting.page.getByTestId('my-area')).toHaveAttribute('data-status', 'folded');
    folders.push(acting);
  }
  const winner = players.find((p) => !folders.includes(p));
  if (!winner) throw new Error('no winner');
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'results');
    // Nobody's cards are shown: not the winner's, not the folders'.
    await expect(p.page.locator('[data-testid="seat-card"][data-rank]')).toHaveCount(0);
    await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText(p === winner ? 'You take the pot' : `${winner.name} takes the pot`);
  }
  await expect(winner.page.getByTestId('my-area')).toHaveAttribute('data-outcome', 'win');
  await scoresMatchChips();
  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  expect(Object.values(chips).reduce((a, b) => a + b, 0)).toBe(TOTAL_CHIPS);

  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 20_000 });
    await expect(end.getByTestId('results-entry')).toHaveCount(3);
  }
  const entries = await host.page.getByTestId('results-entry').evaluateAll((els) => els.map((el) => ({ rank: Number((el as HTMLElement).dataset.rank), name: el.textContent ?? '' })));
  for (const entry of entries) {
    const me = players.find((p) => entry.name.includes(p.name));
    if (!me) throw new Error(`results entry without a player: ${entry.name}`);
    expect(entry.rank).toBe(1 + players.filter((p) => chips[p.name] > chips[me.name]).length);
  }
  for (const p of players) await closeResults(p.page);
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
});

test('a second game: the desktop shortcuts, the panel at 320x568, and the host ends it mid-hand with every stake back', async () => {
  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-phase', 'acting');
  await holeCardsStayPrivate();

  // The small phone: the whole panel still fits at 320x568, and on the standard phone again.
  await quinn.page.setViewportSize(SMALL);
  await phoneLayoutHolds(quinn, SMALL);
  await quinn.page.setViewportSize(PORTRAIT);
  await phoneLayoutHolds(quinn, PORTRAIT);

  // Play until it is the host's move, then C calls or checks from the keyboard.
  for (let moves = 0; moves < 6; moves++) {
    const acting = await actor();
    if (!acting) throw new Error('the hand ended before the host acted');
    if (acting === host) break;
    await move(acting, (await acting.page.getByTestId('action-call').count()) > 0 ? 'action-call' : 'action-check');
  }
  await expect(host.page.getByTestId('action-fold')).toHaveAttribute('aria-keyshortcuts', 'F');
  const before = await stepOnHost();
  await host.page.getByTestId('my-chips').click();
  await host.page.keyboard.press('c');
  await expect.poll(stepOnHost).not.toBe(before);
  await expect(host.page.getByTestId('my-area')).not.toHaveAttribute('data-status', 'folded');

  // The phones' options sheet has no End game for a guest.
  await pia.page.getByTestId('game-menu').click();
  await expect(pia.page.getByTestId('menu-sheet')).toBeVisible();
  await expect(pia.page.getByTestId('end-game')).toHaveCount(0);
  await pia.page.getByTestId('menu-sheet-close').click();

  await host.page.getByTestId('end-game').click();
  await expect(host.page.getByTestId('end-game-confirm')).toContainText('The hand in play is off. Every bet goes back.');
  await host.page.getByTestId('end-game-no').click();
  await expect(screen(host)).toHaveAttribute('data-phase', 'acting');
  await host.page.getByTestId('end-game').click();
  await host.page.getByTestId('end-game-yes').click();
  for (const p of players) {
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page.getByTestId('results-entry')).toHaveCount(3);
    await expect(p.page.getByTestId('results-reason')).toHaveText('The host ended the game.');
  }
  // The stakes went back: three stacks of the starting chips, all sharing first place.
  const ranks = await host.page.getByTestId('results-entry').evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.rank)));
  expect(ranks).toEqual([1, 1, 1]);
  for (const p of players) await closeResults(p.page);
});

const PHONES = [PORTRAIT, { width: 360, height: 740 }, SMALL, { width: 393, height: 688 }, { width: 375, height: 548 }, { width: 390, height: 664 }, { width: 430, height: 740 }, { width: 360, height: 640 }];
const DESKTOPS = [
  { width: 1024, height: 700 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

/**
 * The most other players whose tiles each show their cards, their bet and their stack whole at the
 * cards' floor, by screen (an iPhone in Safari, an SE in Safari, and the rest): past it the room has
 * no height for even the narrow tiles, and the tiles are the crowd's chips.
 */
const SEATS_WHOLE: Record<string, number> = {
  '393x688': 6,
  '375x548': 3,
  '390x664': 6,
  '430x740': 7,
  '360x640': 6,
  '320x568': 3,
  '390x844': 9,
  '360x740': 9,
  '1024x700': 10,
  '1024x768': 10,
  '1280x800': 12,
  '1440x900': 21,
};

/**
 * A Poker table of `size` players (a desktop host, a phone and bots on their own sockets that hold
 * their turns): at every phone size and every desktop nothing scrolls, my hand is on screen, every
 * tile reads, every opponent's cards, bet and stack show whole wherever the room holds them
 * (SEATS_WHOLE), and a desktop's tiles are never squeezed under 28px (a 1280x800 table once pushed
 * my cards off the bottom and its tiles down to 8px).
 */
async function bigTable(browser: Browser, base: string, size: number): Promise<void> {
  const hostCtx = await browser.newContext({ viewport: DESKTOPS[1] });
  const phoneCtx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const desk = await hostCtx.newPage();
  const phone = await phoneCtx.newPage();
  const errors: string[] = [];
  for (const p of [desk, phone]) p.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  try {
    const code = await createParty(desk, 'Hana', 'poker');
    await joinByCode(phone, 'Pia', code);
    bots = await tableBots(size - 2, code, base, { game: 'poker', hold: true, thinkMs: 50 });
    await readyAll([phone]);
    await expectReadyCount(desk, size);
    await desk.getByTestId('start-game').click();
    for (const p of [desk, phone]) {
      await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-phase', 'acting');
      await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
      await expect(p.getByTestId('seat')).toHaveCount(size - 1);
    }
    const fits = async (page: Page, sizes: { width: number; height: number }[]) => {
      const own = page.viewportSize();
      for (const s of sizes) {
        const label = `${size} players at ${s.width}x${s.height}`;
        await page.setViewportSize(s);
        const scrolls = () =>
          page.evaluate(() =>
            ['html', '[data-testid="poker-main"]', '[data-testid="pk-table"]', '[data-testid="seats"]'].filter((sel) => {
              const el = document.querySelector(sel);
              return el !== null && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
            }),
          );
        await expect.poll(scrolls, { message: `${label}: nothing scrolls` }).toEqual([]);
        await myAreaOnScreen(page, 'my-area', label);
        await tilesReadable(page, label, s.width > 760 ? 28 : 0);
        if (size - 1 <= (SEATS_WHOLE[`${s.width}x${s.height}`] ?? 0)) await seatFloors(page, label, s.width > 760 ? 32 : 24);
        await cornersClear(page, label);
      }
      if (own) await page.setViewportSize(own);
    };
    if (size === 12) {
      // Twelve players on a 390x844 phone: four rows of compact tiles have no room under the pot and the board, so the crowd's
      // chips, which leave my cards at least the board's size.
      await expect(phone.getByTestId('seats')).toHaveAttribute('data-tier', 'small');
      const w = await cardWidths(phone);
      expect(w.mine, '12 players: my cards at least as wide as the board’s').toBeGreaterThanOrEqual(w.board - 0.5);
    }
    await fits(phone, PHONES);
    await fits(desk, DESKTOPS);
    // The seat to act is lit on both pages (its tile, unless it is the page's own seat) and named under the ribbon.
    const turn = (await desk.getByTestId('poker-screen').getAttribute('data-turn-player')) ?? '';
    for (const p of [desk, phone]) {
      const own = await p.getByTestId('my-area').getAttribute('data-player-id');
      if (own === turn) await expect(p.getByTestId('table-turn')).toHaveAttribute('data-state', 'mine');
      else {
        await expect(p.locator(`[data-testid="seat"][data-player-id="${turn}"]`)).toHaveAttribute('data-turn', 'true');
        await expect(p.getByTestId('table-turn')).toHaveAttribute('data-state', 'turn');
      }
    }
    expect(errors).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await hostCtx.close();
    await phoneCtx.close();
  }
}

for (const size of [2, 4, 7, 10, 12, 23]) {
  test(`${size} players: the table never scrolls on a phone or a desktop, my hand stays on screen and every tile reads`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    await bigTable(browser, baseURL ?? 'http://localhost:4173', size);
  });
}

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});

/**
 * A 100,000 table, heads-up on two phones: the dealer (first to act heads-up) raises to 12,000, which
 * breaks into two lime chips and two off-white ones (three drawn and a plus). On the other phone the
 * raiser's 218px tile keeps "88,000 chips", the pill, the dealer button and the name apart (three
 * chips, a plus and "12,000" once pushed the stack under the name); by my own cards the dealer
 * button, the raise and the hand's name stay on the stage at 320px and 360px, the dealt name and the
 * longest a phone shows (they once ran 33px past its left edge), the words still over the cards.
 */
/**
 * A 100,000 table of three on a 320px phone (me and two players on bare sockets, moved by the spec):
 * a seat that calls my 12,000 raise gets a pill of chips beside its line, and the 142px tile
 * squeezes the line to "Call 12k" while they fly in; once the street has closed and the chips have
 * gone to the pot, the line has its row again and reads "Call 12,000" in full (it once stayed
 * "Call 12k" for the whole next street, measured only when its tile resized). The seat that closes
 * the street is read, its call being the move that stays on show into the flop; a hand where that
 * seat would then be first to act (me the big blind, the small blind closing), where its line says
 * "Thinking", is folded out first, and the next hand deals me the small blind.
 */
test('a 100,000 table of three on a 320px phone: a seat’s call reads in full once its chips have gone to the pot', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const base = baseURL ?? 'http://localhost:4173';
  const ctx = await browser.newContext({ viewport: SMALL, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  try {
    const code = await createParty(page, 'Hana', 'poker');
    const start = page.getByTestId('settings-startingChips');
    await start.fill('100000');
    await start.press('Enter');
    await expect(start).toHaveValue('100000');
    bots = await tableBots(2, code, base, { game: 'poker', hold: true });
    await expectReadyCount(page, 3);
    await page.getByTestId('start-game').click();
    const screen = page.getByTestId('poker-screen');
    const board = page.getByTestId('board');
    await expect(screen).toHaveAttribute('data-phase', 'acting');
    await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', /^(full|compact)$/);
    const myId = await page.getByTestId('my-area').getAttribute('data-player-id');
    const turn = async () => (await screen.getAttribute('data-turn-player')) ?? '';
    const botOn = (id: string): TableBot => {
      const bot = bots.find((b) => b.id === id);
      if (!bot) throw new Error(`no bot has the turn: ${id}`);
      return bot;
    };
    // Me the big blind (the first bot the button): the button and the small blind fold, and the next hand reads instead.
    const buttonSeat = page.locator('[data-testid="seat"][data-dealer="true"]');
    if ((await page.getByTestId('my-area').getAttribute('data-dealer')) !== 'true' && (await buttonSeat.getAttribute('data-player-id')) === bots[0].id) {
      for (const bot of bots) {
        await expect.poll(turn, { message: `${bot.name} to act` }).toBe(bot.id);
        bot.move({ t: 'fold' });
      }
      await expect(screen).toHaveAttribute('data-hand', '2', { timeout: 20_000 });
      await expect(screen).toHaveAttribute('data-phase', 'acting');
    }
    // Everyone limps round to me, I raise to 12,000 and everyone calls: the last caller closes the street.
    let closer = '';
    for (let moves = 0; moves < 6 && (await board.getAttribute('data-street')) !== 'flop'; moves++) {
      await expect.poll(turn, { message: 'someone to act' }).not.toBe('');
      const id = await turn();
      if (id === myId) {
        await expect(page.getByTestId('action-fold')).toBeEnabled();
        await page.getByTestId('raise-input').fill('12000');
        await page.getByTestId('raise-input').press('Enter');
      } else {
        botOn(id).move({ t: 'call' });
        closer = id;
      }
      await expect.poll(async () => `${await turn()} ${await board.getAttribute('data-street')}`, { message: `the turn passes from ${id}` }).not.toBe(`${id} preflop`);
    }
    await expect(board).toHaveAttribute('data-street', 'flop');
    expect(closer, 'a bot closed the street').not.toBe('');
    // Its chips went to the pot: the line has its row again and reads in full, the first of its forms.
    const seat = page.locator(`[data-testid="seat"][data-player-id="${closer}"]`);
    await expect(seat.getByTestId('seat-bet')).toHaveAttribute('data-bet', '0');
    await expect(seat.getByTestId('seat-line')).toHaveText('Call 12,000');
    await expect(seat.getByTestId('seat-line')).toHaveAttribute('data-fit', '0');
    await expect(page.getByTestId('pot')).toHaveText(/^Pot\s+36,000$/, { useInnerText: true });
    await tilesReadable(page, 'the flop on a 320px phone');
    expect(errors).toEqual([]);
    expect(bots.flatMap((b) => b.errors)).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await ctx.close();
  }
});

test('a 100,000 table: a raise to 12,000 reads on the raiser’s seat and by their cards at every phone size', async ({ browser }) => {
  const phone = { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const contexts = [await browser.newContext(phone), await browser.newContext(phone)];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (err) => errors.push(err.message));
  try {
    const code = await createParty(a, 'Hana', 'poker');
    await joinByCode(b, 'Pia', code);
    const start = a.getByTestId('settings-startingChips');
    await start.fill('100000');
    await start.press('Enter');
    await expect(start).toHaveValue('100000');
    await readyAll([b]);
    await expectReadyCount(a, 2);
    await a.getByTestId('start-game').click();
    for (const p of [a, b]) await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-phase', 'acting');
    const myTurn = (p: Page) => p.locator('[data-testid="my-area"][data-my-turn="true"]').count();
    await expect.poll(async () => (await myTurn(a)) + (await myTurn(b)), { message: 'someone to act' }).toBe(1);
    const raiser = (await myTurn(a)) > 0 ? a : b;
    const watcher = raiser === a ? b : a;
    await expect(raiser.getByTestId('my-area')).toHaveAttribute('data-dealer', 'true');
    await expect(raiser.getByTestId('action-fold')).toBeEnabled();
    await raiser.getByTestId('raise-input').fill('12000');
    await raiser.getByTestId('raise-input').press('Enter');

    const seat = watcher.locator(`[data-testid="seat"][data-name="${raiser === a ? 'Hana' : 'Pia'}"]`);
    await expect(seat).toHaveAttribute('data-bet', '12000');
    await expect(seat.getByTestId('seat-bet')).toHaveText('bet 12k');
    await expect(seat.getByTestId('seat-dealer')).toBeVisible();
    await expect(seat.getByTestId('seat-chips')).toHaveAttribute('data-chips', '88000');
    const scrolls = (p: Page) =>
      p.evaluate(() =>
        ['html', '[data-testid="poker-main"]', '[data-testid="pk-table"]', '[data-testid="seats"]', '[data-testid="hand-stage"]'].filter((sel) => {
          const el = document.querySelector(sel);
          return el !== null && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
        }),
      );
    // The raiser's tile says what happened in whole words at every width ("Raise to 12,000", "Raise 12k" or "Raise" in its pill,
    // never "Raise t…"), and the pot reads in full ("Pot 12,010": the raise and the big blind's 10) wherever it fits, a desktop's too.
    for (const size of [SMALL, { width: 360, height: 740 }, PORTRAIT, { width: 414, height: 896 }, { width: 430, height: 932 }, ...DESKTOPS]) {
      const label = `the raiser’s seat at ${size.width}x${size.height}`;
      await watcher.setViewportSize(size);
      await expect(watcher.getByTestId('seats')).toHaveAttribute('data-tier', 'full');
      await expect.poll(() => scrolls(watcher), { message: `${label}: nothing scrolls` }).toEqual([]);
      await tilesReadable(watcher, label);
      await expect(seat.getByTestId('seat-line'), label).toHaveText(/^(Raise to 12,000|Raise 12k|Raise)$/);
      if (size.width > 760) await expect(seat.getByTestId('seat-line'), `${label}: in full on a desktop`).toHaveText('Raise to 12,000');
      await expect(watcher.getByTestId('pot'), label).toHaveText(/^Pot\s+12,010$/, { useInnerText: true });
      await cornersClear(watcher, label);
    }

    await expect(raiser.locator('[data-testid="my-bet"] .tbl-stake')).toHaveAttribute('data-bet', '12000');
    await expect(raiser.getByTestId('my-dealer')).toBeVisible();
    // By my cards my raise reads in full, as the seats' pills read it, at every phone size and on a desktop (it once read "12k" even at
    // 1440 wide), and the pill, the dealer button and the hand's name never cover a rank or a suit.
    for (const size of [SMALL, { width: 360, height: 740 }, PORTRAIT, { width: 430, height: 932 }, ...DESKTOPS]) {
      const label = `my raise at ${size.width}x${size.height}`;
      await raiser.setViewportSize(size);
      await expect(raiser.locator('[data-testid="my-bet"] .tbl-stake'), label).toHaveText(/^\+?\s*12,000$/, { useInnerText: true });
      await expect(raiser.getByTestId('pot'), label).toHaveText(/^Pot\s+12,010$/, { useInnerText: true });
      await cornersClear(raiser, label);
    }
    // The words over my cards (the dealer button, the raise, the hand's name): wholly on the stage, their right end over the cards' right edge.
    const head = () =>
      raiser.evaluate(() => {
        const stage = document.querySelector('[data-testid="hand-stage"]')?.getBoundingClientRect();
        const words = document.querySelector('[data-testid="my-cards"] .tbl-hand__head')?.getBoundingClientRect();
        const fan = document.querySelector('[data-testid="my-cards"] .tbl-fan')?.getBoundingClientRect();
        if (!stage || !words || !fan) return 'missing';
        if (words.left < stage.left - 0.5 || words.right > stage.right + 0.5) return `the words at ${Math.round(words.left)} to ${Math.round(words.right)}, the stage ${Math.round(stage.left)} to ${Math.round(stage.right)}`;
        return Math.abs(words.right - fan.right) <= 1.5 ? 'on the stage, over the cards' : `the words end at ${Math.round(words.right)}, the cards at ${Math.round(fan.right)}`;
      });
    const name = raiser.getByTestId('hand-hint');
    const dealt = (await name.textContent()) ?? '';
    expect(dealt).toMatch(/^(Pair of .+|.+ high)$/);
    for (const size of [SMALL, { width: 360, height: 740 }]) {
      await raiser.setViewportSize(size);
      for (const words of [dealt, 'Pair of queens', 'Three of a kind', dealt]) {
        // The name's own text node, so the page keeps it until the hand changes.
        await name.evaluate((el, text) => {
          const node = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
          if (node) node.nodeValue = text;
        }, words);
        const label = `my raise by my cards at ${size.width}x${size.height}, "${words}"`;
        await expect.poll(head, { message: label }).toBe('on the stage, over the cards');
        await expect.poll(() => scrolls(raiser), { message: `${label}: nothing scrolls` }).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
  } finally {
    for (const c of contexts) await c.close();
  }
});

test('a move picked before my turn: Pia ticks Call any while Hana raises, and the call goes the moment her turn starts', async ({ browser }) => {
  const phone = { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const contexts = [await browser.newContext(phone), await browser.newContext(phone)];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (err) => errors.push(err.message));
  try {
    const code = await createParty(a, 'Hana', 'poker');
    await joinByCode(b, 'Pia', code);
    await readyAll([b]);
    await expectReadyCount(a, 2);
    await a.getByTestId('start-game').click();
    for (const p of [a, b]) await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-phase', 'acting');
    const myTurn = (p: Page) => p.locator('[data-testid="my-area"][data-my-turn="true"]').count();
    await expect.poll(async () => (await myTurn(a)) + (await myTurn(b)), { message: 'someone to act' }).toBe(1);
    // Heads up the button acts first before the flop; the big blind waits with checking free.
    const acting = (await myTurn(a)) > 0 ? a : b;
    const waiting = acting === a ? b : a;
    const panel = waiting.getByTestId('pk-panel');
    await expect(panel).toHaveAttribute('data-premove', 'none');
    await expect(waiting.getByTestId('premove-check')).toHaveAttribute('aria-label', 'Check when it’s my turn');
    for (const id of ['premove-checkFold', 'premove-check', 'premove-callAny']) await expect(waiting.getByTestId(id)).toHaveAttribute('aria-pressed', 'false');
    // One pick at a time: a tap ticks it, a tap on another moves the tick, a second tap unticks it.
    await waiting.getByTestId('premove-check').click();
    await expect(waiting.getByTestId('premove-check')).toHaveAttribute('aria-pressed', 'true');
    await waiting.getByTestId('premove-callAny').click();
    await expect(waiting.getByTestId('premove-check')).toHaveAttribute('aria-pressed', 'false');
    await waiting.getByTestId('premove-callAny').click();
    await expect(panel).toHaveAttribute('data-premove', 'none');
    // Ticked, Check/Fold still reads whole on a phone.
    await waiting.getByTestId('premove-checkFold').click();
    await expect(waiting.locator('[data-testid="premove-checkFold"] .tbl-move__label')).toHaveJSProperty('scrollWidth', await waiting.locator('[data-testid="premove-checkFold"] .tbl-move__label').evaluate((el) => el.clientWidth));
    await waiting.getByTestId('premove-callAny').click();
    await expect(waiting.getByTestId('premove-callAny')).toHaveAttribute('aria-pressed', 'true');
    await expect(waiting.getByTestId('premove-callAny')).toHaveAttribute('data-queued', 'true');
    await waiting.screenshot({ path: test.info().outputPath('poker-premove-390x844.png') });
    await waiting.setViewportSize({ width: 1040, height: 1060 });
    await expect(waiting.getByTestId('premove-callAny')).toHaveAttribute('aria-pressed', 'true');
    await waiting.screenshot({ path: test.info().outputPath('poker-premove-1040x1060.png') });
    await waiting.setViewportSize(PORTRAIT);

    // The button raises to 60: Call any survives the bet and calls it, with no tap from the big blind.
    await acting.getByTestId('raise-input').fill('60');
    await acting.getByTestId('raise-input').press('Enter');
    await expect(acting.getByTestId('board')).toHaveAttribute('data-street', 'flop', { timeout: 15_000 });
    await expect(waiting.getByTestId('pot')).toHaveText(/^Pot\s+120$/, { useInnerText: true });
    await expect(panel).not.toHaveAttribute('data-premove', 'callAny');
    expect(errors).toEqual([]);
  } finally {
    for (const c of contexts) await c.close();
  }
});
