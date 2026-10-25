import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { createParty, expectReadyCount } from './party';
import { cornersClear, seatFloors, stakesShown, tilesReadable } from './tableFit';
import { tableBots, type TableBot } from './tableBots';

/**
 * Blackjack's fixed places. On a real table (a page and bots on their own sockets, at 390x844,
 * 320x568 and 1440x900, with 2 and 6 players, and 4 on the 320x568) the dealer's hand and the stage
 * at the bottom never move or resize through the betting, the deal, my turn, another player's turn,
 * the dealer's play and the settled table. Then a harness (e2e/harness: the real components and styles, built by
 * Vite, fed rigged snapshots) seats me with 2 to 16 split hands at every phone size and on a
 * desktop: every hand is its cards at the size one hand gets there, side by side, and past what
 * fits the row of hands scrolls sideways inside its box (its cut ends fading, the hand in play
 * brought into view as play moves on) while the page never scrolls; my hands keep the stage on
 * another player's turn, and a watcher sees that player's many hands the same way on the stage. On another player's turn on the real table my hand stays at the bottom centre at full
 * size and theirs shows once, in their seat. The cards are really shuffled on the real table, so a
 * natural or the dealer's blackjack just means another round.
 */
test.describe.configure({ mode: 'serial' });

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 1440, height: 900 },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  return box;
}

/** The two fixed places, read once the layout has settled (two reads a frame apart agree). */
async function places(page: Page): Promise<{ dealer: Box; mine: Box }> {
  const read = async () => ({ dealer: await boxOf(page, 'dealer-area'), mine: await boxOf(page, 'hand-stage') });
  let last = await read();
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const next = await read();
    if (JSON.stringify(next) === JSON.stringify(last)) return next;
    last = next;
  }
  return last;
}

function expectSame(label: string, a: Box, b: Box): void {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k]), `${label}: ${k} ${a[k]} -> ${b[k]}`).toBeLessThanOrEqual(1);
}

/** Nothing on the page scrolls: the document, the table, the players. */
async function nothingScrolls(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => {
    const scrolls = (el: Element | null) => (el ? el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight : false);
    return {
      document: scrolls(document.documentElement),
      main: scrolls(document.querySelector('[data-testid="blackjack-main"]')),
      table: scrolls(document.querySelector('[data-testid="bj-table"]')),
      seats: scrolls(document.querySelector('[data-testid="seats"]')),
      mine: scrolls(document.querySelector('[data-testid="my-hands"]')),
      stage: scrolls(document.querySelector('[data-testid="hand-stage"]')),
    };
  });
  expect(over, `${label}: nothing scrolls`).toEqual({ document: false, main: false, table: false, seats: false, mine: false, stage: false });
}

/** The width the table works its cards out at (the dealer's row and the stage share it), in px. */
const cardWidth = (page: Page): Promise<number> => page.getByTestId('bj-table').evaluate((el) => Math.round(parseFloat(getComputedStyle(el).getPropertyValue('--bj-card-w')) * 10) / 10);

/**
 * Another player's turn: my hand stays on the stage at the bottom centre at full size (its cards
 * as wide as the dealer's, never shrunk into a side column), and the acting player's hand shows
 * at most once, in their own seat and never on the stage; exactly once where the seats show their
 * cards (four or fewer other players).
 */
async function turnShownOnce(page: Page, turnId: string, label: string): Promise<void> {
  const read = () =>
    page.evaluate((turn) => {
      const stage = document.querySelector('[data-testid="hand-stage"]')?.getBoundingClientRect();
      const hand = document.querySelector('[data-testid="hand-stage"] [data-testid="my-area"] [data-testid="my-hand"]');
      const mine = hand?.getBoundingClientRect();
      const myCard = hand?.querySelector('[data-testid="card"]')?.getBoundingClientRect();
      const dealerCard = document.querySelector('[data-testid="dealer-card"]')?.getBoundingClientRect();
      const seat = document.querySelector(`[data-testid="seat"][data-player-id="${turn}"]`);
      const tier = document.querySelector('[data-testid="seats"]')?.getAttribute('data-tier');
      return {
        onStage: !!(mine && stage),
        centred: !!(mine && stage && mine.left <= stage.left + stage.width / 2 && mine.right >= stage.left + stage.width / 2),
        atBottom: !!(mine && stage && Math.abs(mine.bottom - stage.bottom) <= 6),
        fullSize: !!(myCard && dealerCard && Math.abs(myCard.width - dealerCard.width) <= 1),
        theirsOnStage: document.querySelectorAll('[data-testid="stage-hand"], [data-testid="hand-stage"] [data-testid="seat-hand"]').length,
        theirsShown: (seat?.querySelectorAll('[data-testid="seat-hand"]').length ?? 0) + document.querySelectorAll('[data-testid="stage-hand"]').length,
        tier,
      };
    }, turnId);
  await expect
    .poll(
      async () => {
        const r = await read();
        return { onStage: r.onStage, centred: r.centred, atBottom: r.atBottom, fullSize: r.fullSize, theirsOnStage: r.theirsOnStage, once: r.tier === 'full' ? r.theirsShown === 1 : r.theirsShown <= 1 };
      },
      { message: `${label}: my hand at the bottom centre at full size, theirs once, in their seat` },
    )
    .toEqual({ onStage: true, centred: true, atBottom: true, fullSize: true, theirsOnStage: 0, once: true });
}

/**
 * One table of `players` at `size`: the places are read in every phase of a round and must never
 * move. Rounds go on until my turn and a bot's turn have both been seen (a natural skips a turn).
 */
async function fixedPlaces(browser: Browser, base: string, size: { width: number; height: number }, players: number): Promise<void> {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  const label = `${players} players at ${size.width}x${size.height}`;
  try {
    const code = await createParty(page, 'Hana', 'blackjack');
    bots = await tableBots(players - 1, code, base, { game: 'blackjack', hold: true, thinkMs: 50 });
    await expectReadyCount(page, players);
    await page.getByTestId('start-game').click();
    const screen = page.getByTestId('blackjack-screen');
    await expect(screen).toHaveAttribute('data-phase', 'betting');
    await expect(page.getByTestId('seat')).toHaveCount(players - 1);
    const botIds = new Set(bots.map((b) => b.id));
    const ref = await places(page);
    // A 390x844 phone with one other player: the cards take the felt the seat leaves them (55.5px when they went by the
    // table's height alone) up to where the dealer's four and a card-wide shoe would still fit beside each other, 61.9px (71px
    // beside the old 34px shoe); the shoe itself is 70% of a card (the owner found a full card too big), and the cards keep
    // their size through the round (the places below).
    if (size.width === 390 && size.height === 844 && players === 2) {
      const card = await cardWidth(page);
      expect(card, `${label}: the cards`).toBeGreaterThanOrEqual(61.5);
      const deck = await page.getByTestId('bj-table').evaluate((el) => Math.round(parseFloat(getComputedStyle(el).getPropertyValue('--tbl-deck-w')) * 10) / 10);
      expect(deck, `${label}: the shoe is 70% of a card`).toBe(Math.round(card * 7) / 10);
    }
    if (size.width === 320 && players === 4) await expect(page.getByTestId('seats'), `${label}: the seats`).toHaveAttribute('data-tier', 'compact');
    const seen = new Set<string>();
    const check = async (phase: string) => {
      const now = await places(page);
      expectSame(`${label}, ${phase}: the dealer’s hand`, ref.dealer, now.dealer);
      expectSame(`${label}, ${phase}: my hands`, ref.mine, now.mine);
      await nothingScrolls(page, `${label}, ${phase}`);
      // Every other player's stack and bet read at a glance, however small the phone.
      await stakesShown(page, `${label}, ${phase}`);
      await tilesReadable(page, `${label}, ${phase}`);
      // Every rank and suit of my cards and the dealer's reads whole: nothing over a card's corner.
      await cornersClear(page, `${label}, ${phase}`, { dealer: true });
      seen.add(phase);
    };
    await check('betting');
    const roundOf = async () => Number(await page.getByTestId('round-indicator').getAttribute('data-round'));
    for (let round = 1; round <= 8 && !(seen.has('my turn') && seen.has("another player’s turn")); round++) {
      await expect.poll(roundOf, { timeout: 20_000 }).toBe(round);
      for (const b of bots) b.setHold(true);
      await expect(page.getByTestId('place-bet')).toBeEnabled({ timeout: 20_000 });
      await page.getByTestId('place-bet').click();
      // The deal (or a dealer blackjack, settled at once): read while the cards are still sliding in.
      await expect.poll(async () => (await screen.getAttribute('data-phase')) !== 'betting' || (await roundOf()) > round, { timeout: 20_000 }).toBe(true);
      await check('the deal');
      for (let step = 0; step < 12; step++) {
        const state = async () => {
          if ((await roundOf()) > round) return 'settled';
          if ((await page.locator('[data-testid="action-stand"]:not([aria-pressed]):enabled').count()) > 0) return 'mine';
          const turn = (await screen.getAttribute('data-turn-player')) ?? '';
          return botIds.has(turn) ? 'bot' : null;
        };
        await expect.poll(state, { timeout: 20_000, message: `${label}: a turn or the settle` }).not.toBeNull();
        const now = await state();
        if (now === 'settled') break;
        if (now === 'mine') {
          await expect(page.getByTestId('hand-stage')).toHaveAttribute('data-kind', 'mine');
          await check('my turn');
          const before = await screen.getAttribute('data-turn-hand');
          await page.getByTestId('action-stand').click();
          await expect.poll(async () => (await roundOf()) > round || (await page.locator('[data-testid="action-stand"]:not([aria-pressed]):enabled').count()) === 0 || (await screen.getAttribute('data-turn-hand')) !== before).toBe(true);
          continue;
        }
        await expect(page.getByTestId('hand-stage')).toHaveAttribute('data-kind', 'turn');
        await check("another player’s turn");
        await turnShownOnce(page, (await screen.getAttribute('data-turn-player')) ?? '', `${label}, another player’s turn`);
        for (const b of bots) b.setHold(false);
        break;
      }
      // The dealer plays where it always sits (caught when the reveal is still on), then the settled table.
      const kind = page.getByTestId('hand-stage');
      await expect(kind).toHaveAttribute('data-kind', /^(dealer|result|bets)$/, { timeout: 30_000 });
      if ((await kind.getAttribute('data-kind')) === 'dealer') await check("the dealer’s play");
      await expect(kind).toHaveAttribute('data-kind', /^(result|bets)$/, { timeout: 30_000 });
      await check('the results');
    }
    expect([...seen].sort(), label).toEqual(expect.arrayContaining(['another player’s turn', 'betting', 'my turn', 'the deal', 'the results']));
    expect(errors).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await ctx.close();
  }
}

for (const players of [2, 6]) {
  for (const size of SIZES) {
    test(`${players} players at ${size.width}x${size.height}: the dealer’s hand and mine never move or resize, whatever the phase`, async ({ browser, baseURL }) => {
      test.setTimeout(120_000);
      await fixedPlaces(browser, baseURL ?? 'http://localhost:4173', size, players);
    });
  }
}

// Four players on the narrowest phone: three full tiles across it would be 93px, too narrow for "1,000 chips" beside the face (it read
// "1,000 chip"), so the other three sit on compact tiles, every stack whole, in every phase.
test('4 players at 320x568: the dealer’s hand and mine never move or resize, and every stack reads whole', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  await fixedPlaces(browser, baseURL ?? 'http://localhost:4173', { width: 320, height: 568 }, 4);
});

/** Stands my hands until round `round` settles (the bots play theirs), then waits for its results on the stage. */
async function playOut(page: Page, round: number): Promise<void> {
  const roundOf = async () => Number(await page.getByTestId('round-indicator').getAttribute('data-round'));
  for (let step = 0; step < 12 && (await roundOf()) <= round; step++) {
    const stand = page.getByTestId('action-stand');
    await expect.poll(async () => (await roundOf()) > round || (await stand.isEnabled()), { timeout: 20_000, message: `round ${round}: my turn or the settle` }).toBe(true);
    if ((await roundOf()) > round) break;
    await stand.click();
    await expect.poll(async () => (await roundOf()) > round || !(await stand.isEnabled()), { timeout: 20_000 }).toBe(true);
  }
  await expect(page.getByTestId('hand-stage')).toHaveAttribute('data-kind', /^(result|bets)$/, { timeout: 30_000 });
}

/**
 * The cards on a phone take the room the seats leave, as many seats as the round on the table was
 * dealt with: three players leaving in the middle of a round leave the cards as they are until the
 * round is over, and the next deal sizes them for the two seats left (total-only tiles become one
 * row of full ones, and the cards take the rest).
 */
test('390x844: three players leave mid-round: the cards keep their size to the end of the round, and the next deal sizes them for the seats left', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  try {
    const code = await createParty(page, 'Hana', 'blackjack');
    bots = await tableBots(5, code, baseURL ?? 'http://localhost:4173', { game: 'blackjack', hold: true, thinkMs: 50 });
    await expectReadyCount(page, 6);
    await page.getByTestId('start-game').click();
    const screen = page.getByTestId('blackjack-screen');
    const table = page.getByTestId('bj-table');
    await expect(screen).toHaveAttribute('data-phase', 'betting');
    await expect(page.getByTestId('seat')).toHaveCount(5);
    await expect(table).toHaveAttribute('data-seats', '5');
    const five = await cardWidth(page);
    const ref = await places(page);
    const same = async (label: string) => {
      const now = await places(page);
      expectSame(`${label}: the dealer’s hand`, ref.dealer, now.dealer);
      expectSame(`${label}: my hands`, ref.mine, now.mine);
      expect(await cardWidth(page), `${label}: the cards`).toBe(five);
      await nothingScrolls(page, label);
      await tilesReadable(page, label);
    };
    // Round 1 is dealt, then three of the five leave in the middle of it.
    await page.getByTestId('place-bet').click();
    await expect.poll(async () => (await screen.getAttribute('data-phase')) !== 'betting', { timeout: 20_000 }).toBe(true);
    for (const b of bots.slice(2)) b.leave();
    await expect(page.getByTestId('seat')).toHaveCount(2);
    // The round goes on as it was dealt: five seats' worth of room, the cards where and as big as they were.
    await expect(table).toHaveAttribute('data-seats', '5');
    await same('round 1, three seats gone');
    for (const b of bots) b.setHold(false);
    await playOut(page, 1);
    await same('round 1 settled');
    // Round 2 is dealt to the two seats left (one row of full tiles): the cards take the room the three seats gave back, up to
    // where the dealer's four and a shoe their own size still fit beside each other (60.6px to 61.9px; the room would take them
    // past 70px).
    await expect(page.getByTestId('place-bet')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('place-bet').click();
    await expect(table).toHaveAttribute('data-seats', '2', { timeout: 20_000 });
    await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', 'full');
    await expect.poll(() => cardWidth(page), { message: 'round 2: the cards for two seats' }).toBeGreaterThan(five);
    await expect.poll(() => cardWidth(page), { message: 'round 2: the cards up to the shoe’s room' }).toBeGreaterThanOrEqual(61.5);
    const three = await cardWidth(page);
    const ref2 = await places(page);
    expect(ref2.mine.height, 'round 2: a taller stage').toBeGreaterThan(ref.mine.height);
    await playOut(page, 2);
    const now = await places(page);
    expectSame('round 2 settled: the dealer’s hand', ref2.dealer, now.dealer);
    expectSame('round 2 settled: my hands', ref2.mine, now.mine);
    expect(await cardWidth(page), 'round 2 settled: the cards').toBe(three);
    await nothingScrolls(page, 'round 2 settled');
    await tilesReadable(page, 'round 2 settled');
    expect(errors).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// The harness: many split hands
// ---------------------------------------------------------------------------

const HARNESS_PORT = 5199;

/*
 * The harness is built once and served as plain files, not by the Vite dev server. Each load of
 * the dev harness asks for ~400 modules, most answered 304 Not Modified, and Chromium keeps a 2 MB
 * shared-memory region alive per 304 until a V8 GC: ~0.8 GB per page.goto, which these tests'
 * many loads on one page pile up to ~20 GB. Under --disable-dev-shm-usage those regions are
 * deleted files in $TMPDIR that du cannot see, and a full disk fails every load with
 * net::ERR_INSUFFICIENT_RESOURCES. Built, a load is a handful of files, sent with no-store and no
 * validators so none is ever revalidated into a 304.
 */
let harnessDir: string | null = null;
let harnessServer: Server | null = null;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves the built harness from `dir`: "/" (the harness, its scenario in the query) is index.html. */
async function serveHarness(dir: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let path = '';
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    // A malformed path is simply not found.
  }
  const file = resolve(dir, `.${path === '/' ? '/index.html' : path}`);
  const body = file.startsWith(dir + sep) ? await readFile(file).catch(() => null) : null;
  if (!body) {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' }).end(body);
}

test.describe('many hands (the harness)', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const root = fileURLToPath(new URL('..', import.meta.url));
    const dir = await mkdtemp(join(tmpdir(), 'bj-harness-'));
    harnessDir = dir;
    const nodeEnv = process.env.NODE_ENV;
    try {
      await build({
        configFile: false,
        root: `${root}e2e/harness`,
        publicDir: `${root}client/public`,
        plugins: [react()],
        resolve: { alias: { '@shared': `${root}shared` } },
        build: { outDir: dir, emptyOutDir: true, reportCompressedSize: false },
        logLevel: 'error',
      });
    } finally {
      // build() sets NODE_ENV=production for this whole worker when it is unset: put it back, so servers later specs spawn don't inherit it.
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
    const server = createServer((req, res) => {
      serveHarness(dir, req, res).catch(() => res.destroy());
    });
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(HARNESS_PORT, 'localhost', () => {
        server.off('error', fail);
        done();
      });
    });
    harnessServer = server;
  });

  test.afterAll(async () => {
    const server = harnessServer;
    harnessServer = null;
    if (server) {
      const closed = new Promise<void>((done) => server.close(() => done()));
      server.closeAllConnections();
      await closed;
    }
    if (harnessDir) await rm(harnessDir, { recursive: true, force: true });
    harnessDir = null;
  });

  /** Every element `items` finds in `container` lies wholly inside it (a row of hands: anywhere it scrolls to), give or take `slack` px. */
  async function allInside(page: Page, container: string, items: string, slack = 1): Promise<{ outside: number; count: number }> {
    return page.evaluate(
      ([c, q, d]) => {
        const box = document.querySelector(`[data-testid="${c}"]`)?.getBoundingClientRect();
        if (!box) return { outside: -1, count: 0 };
        const els = Array.from(document.querySelectorAll(`[data-testid="${c}"] :is(${q})`)).filter((el) => el.getBoundingClientRect().width > 0);
        const outside = els.filter((el) => {
          const r = el.getBoundingClientRect();
          // In a row of hands that scrolls sideways, inside is anywhere the row scrolls to.
          const row = el.closest<HTMLElement>('.scroll-fade--x');
          const rowBox = row ? row.getBoundingClientRect() : null;
          const left = row && rowBox ? rowBox.left - row.scrollLeft : box.left;
          const right = row && rowBox ? left + row.scrollWidth : box.right;
          return r.left < left - d || r.right > right + d || r.top < box.top - d || r.bottom > box.bottom + d;
        }).length;
        return { outside, count: els.length };
      },
      [container, items, slack] as const,
    );
  }

  async function open(page: Page, query: string): Promise<void> {
    await page.goto(`http://localhost:${HARNESS_PORT}/?${query}`);
    await expect(page.getByTestId('blackjack-screen')).toBeVisible();
  }

  /**
   * Harness pages at `size` for a long run of scenes: a fresh browser context every 15 loads, so a
   * run never piles up one context's memory. `go(query)` loads a scene and returns its page; the
   * page errors of every context are kept in `errors`.
   */
  function harnessPages(browser: Browser, size: { width: number; height: number }) {
    let ctx: BrowserContext | null = null;
    let page: Page | null = null;
    let loads = 0;
    const errors: string[] = [];
    return {
      errors,
      async go(query: string): Promise<Page> {
        if (!ctx || !page || loads >= 15) {
          await ctx?.close();
          ctx = await browser.newContext({ viewport: size });
          page = await ctx.newPage();
          page.on('pageerror', (err) => errors.push(err.message));
          loads = 0;
        }
        loads += 1;
        await open(page, query);
        return page;
      },
      async close(): Promise<void> {
        await ctx?.close();
      },
    };
  }

  /**
   * A row of hands (`row`, its test id) as it shows: how many hands and cards, the cards' widths
   * (one size for every card), how far it scrolls each way, the fade it shows at each end and which
   * it should (an end with hands past it), every hand within the row's height, and the hand in play
   * (its index, and how far its slot sits inside the row's visible box: never under a fading end).
   */
  async function rowShown(page: Page, row: string) {
    return page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const hands = Array.from(el.querySelectorAll<HTMLElement>('.bj-slot > .bj-hand'));
      const cards = Array.from(el.querySelectorAll<HTMLElement>('.playing-card')).map((c) => Math.round(c.getBoundingClientRect().width * 2) / 2);
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const lit = el.querySelector<HTMLElement>('.bj-hand[data-active="true"]');
      const slot = lit?.closest('.bj-slot')?.getBoundingClientRect();
      const fade = el.dataset.fade ?? '';
      return {
        hands: hands.length,
        cards: cards.length,
        sizes: [...new Set(cards)],
        sideways: el.scrollWidth > el.clientWidth + 1,
        down: el.scrollHeight > el.clientHeight + 1,
        fade,
        due: [left ? 'left' : '', right ? 'right' : ''].filter(Boolean).join(' '),
        masked: getComputedStyle(el).maskImage !== 'none',
        taller: hands.filter((h) => h.getBoundingClientRect().top < box.top - 1 || h.getBoundingClientRect().bottom > box.bottom + 1).length,
        active: lit ? Number(lit.dataset.index) : -1,
        // The hand in play's slot inside the row's visible box, clear of a fading end (28px).
        inView: slot ? slot.left >= box.left + (fade.includes('left') ? 27 : -1) && slot.right <= box.right - (fade.includes('right') ? 27 : -1) : null,
      };
    }, row);
  }

  /** My split hands' words (each total, stake chip and outcome) that spill out of their own cell, and cells that meet, in my row. */
  async function labelsInCells(page: Page): Promise<{ spill: number; overlap: number }> {
    return page.evaluate(() => {
      const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="my-hands-row"] > .bj-slot')).map((el) => ({ el, r: el.getBoundingClientRect() }));
      let spill = 0;
      let overlap = 0;
      for (const { el, r } of slots) {
        for (const w of Array.from(el.querySelectorAll<HTMLElement>('.tbl-hand__head, .bj-hand__foot'))) {
          const b = w.getBoundingClientRect();
          if (b.width > 0 && (b.left < r.left - 1 || b.right > r.right + 1)) spill += 1;
        }
      }
      for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
          const a = slots[i].r;
          const b = slots[j].r;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap += 1;
        }
      }
      return { spill, overlap };
    });
  }

  /** How far the stage's top sits below every other row of the table (the dealer, the banner, the seats): never negative. */
  async function stageClear(page: Page): Promise<number> {
    return page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('[data-testid="hand-stage"]');
      const felt = stage?.closest<HTMLElement>('.tbl-felt');
      if (!stage || !felt) return -999;
      const top = stage.getBoundingClientRect().top;
      const over = Array.from(felt.children)
        .filter((c) => c !== stage && !c.contains(stage) && !['absolute', 'fixed'].includes(getComputedStyle(c).position) && getComputedStyle(c).display !== 'none')
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.top < top);
      return Math.round(Math.min(...over.map((r) => top - r.bottom)));
    });
  }

  // The owner's screenshot: six split hands with big stakes on a wide stage. Each stake and total once set its hand's width, and the
  // cards shrank to ~20px slivers in one row at the stage's foot, the sixth cut off behind the fade, the table's middle empty.
  for (const size of [{ width: 1040, height: 1060 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    test(`${size.width}x${size.height}: six and eight split hands with big stakes wrap into a grid of readable cards, every word on its own hand`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      try {
        // The card a hand on its own gets here.
        const one = await rowShown(await pages.go('phase=mine&others=3&hands=1&cards=2&start=100000&stake=50000&bet=40500&chips=150000'), 'my-hands-row');
        const solo = one?.sizes[0] ?? 0;
        for (const hands of [2, 4, 6, 8]) {
          for (const phase of ['mine', 'results']) {
            const page = await pages.go(`phase=${phase}&others=3&hands=${hands}&active=2&cards=2&start=100000&stake=50000&bet=40500&chips=150000`);
            const label = `${hands} hands, ${phase}`;
            await expect(page.getByTestId('my-hand'), label).toHaveCount(hands);
            const shown = await rowShown(page, 'my-hands-row');
            if (!shown) throw new Error(`${label}: no row of hands`);
            expect(shown, label).toMatchObject({ hands, sideways: false, fade: '', taller: 0 });
            expect(shown.sizes, `${label}: one card size`).toHaveLength(1);
            // Readable cards: never the slivers of a row the words had set.
            // Two hands keep (near enough) a hand alone's cards; more never shrink to the slivers of a row the words had set.
            const least = hands === 2 ? solo - 3 : Math.min(solo - 3, size.width >= 1000 ? (hands <= 6 ? 56 : 48) : hands <= 4 ? 34 : hands <= 6 ? 28 : 20);
            expect(shown.sizes[0], `${label}: the cards (a hand alone ${solo})`).toBeGreaterThanOrEqual(least);
            await expect.poll(() => allInside(page, 'hand-stage', '.bj-hand, .playing-card, .bj-hand__foot'), { message: `${label}: every hand inside the stage` }).toMatchObject({ outside: 0 });
            expect(await labelsInCells(page), `${label}: the words keep to their hand`).toEqual({ spill: 0, overlap: 0 });
            expect(await stageClear(page), `${label}: the stage clear of the banner and the seats`).toBeGreaterThanOrEqual(0);
            await nothingScrolls(page, label);
            await cornersClear(page, label, { dealer: true });
            if (phase === 'mine') {
              // Each stake short, under its cards; the hand in play lit.
              expect(await page.getByTestId('hand-bet').first().innerText(), label).toBe('50k');
              await expect(page.locator('[data-testid="my-hand"][data-active="true"]'), label).toHaveAttribute('data-index', String(Math.min(2, hands - 1)));
            } else {
              await expect(page.getByTestId('hand-outcome'), label).toHaveCount(hands);
            }
          }
        }
      } finally {
        await pages.close();
      }
    });
  }

  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 428, height: 753 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: every hand of mine shows at once, its cards at one size, shrunk to fit, scrolling only past the least card`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      const errors = pages.errors;
      try {
        let ref: { dealer: Box; mine: Box } | null = null;
        // The card a hand on its own gets here: split hands shrink from it, all to one size, to show at once.
        let card = 0;
        let page: Page;
        for (const hands of [1, 2, 4, 6, 8, 16]) {
          for (const phase of ['mine', 'results', 'other', 'over']) {
            const active = Math.floor(hands / 2);
            page = await pages.go(`phase=${phase}&others=5&hands=${hands}&active=${active}&cards=3&allCards=1`);
            const label = `${hands} hands, ${phase}`;
            await expect(page.getByTestId('my-hand'), label).toHaveCount(hands);
            const shown = await rowShown(page, 'my-hands-row');
            if (!shown) throw new Error(`${label}: no row of hands`);
            if (card === 0) card = shown.sizes[0] ?? 0;
            // Every hand as its three cards, every card one size (a hand alone the solo size), the row never taller than its box.
            expect(shown, label).toMatchObject({ hands, cards: hands * 3, down: false, taller: 0 });
            expect(shown.sizes, `${label}: one card size`).toHaveLength(1);
            if (hands === 1) expect(shown.sizes[0], label).toBe(card);
            else expect(shown.sizes[0], `${label}: never bigger than a hand alone`).toBeLessThanOrEqual(card);
            expect(card, label).toBeGreaterThanOrEqual(30);
            // Up to eight hands (any realistic run of splits) all show at once in a grid, never a row scrolling sideways, every hand and card inside the stage,
            // the words on a hand (its total, its stake chip, how it ended) inside its own cell and no two cells meeting. Past that (16 on a 320px phone)
            // the hands still never leave the stage, their words may crowd.
            if (hands <= 8) {
              expect(shown.sideways, `${label}: every hand shows at once`).toBe(false);
              expect(shown.fade, `${label}: no fade`).toBe('');
              await expect.poll(() => allInside(page, 'hand-stage', '.bj-hand, .playing-card, .bj-hand__foot'), { message: `${label}: no hand clipped` }).toMatchObject({ outside: 0 });
              expect(await labelsInCells(page), `${label}: the words keep to their hand`).toEqual({ spill: 0, overlap: 0 });
            } else {
              await expect
                .poll(async () => {
                  const r = await rowShown(page, 'my-hands-row');
                  return r && { fade: r.fade === r.due, masked: r.masked === (r.due !== '') };
                }, { message: `${label}: the ends with more hands past them fade` })
                .toEqual({ fade: true, masked: true });
            }
            await nothingScrolls(page, label);
            // The rank and suit of every card in my row and the dealer's read whole.
            await cornersClear(page, label, { dealer: true });
            // The dealer never moves; the stage keeps its bottom and width, and only grows up into the room the table leaves empty, clear of the banner and the seats.
            const fixed = await places(page);
            if (ref === null) ref = fixed;
            expectSame(`${label}: the dealer’s hand`, ref.dealer, fixed.dealer);
            expect(Math.abs(fixed.mine.y + fixed.mine.height - (ref.mine.y + ref.mine.height)), `${label}: the stage’s bottom`).toBeLessThanOrEqual(1);
            expect(Math.abs(fixed.mine.width - ref.mine.width), `${label}: the stage’s width`).toBeLessThanOrEqual(1);
            expect(fixed.mine.height, `${label}: the stage never shrinks`).toBeGreaterThanOrEqual(ref.mine.height - 1);
            expect(await stageClear(page), `${label}: the stage clear of the rows over it`).toBeGreaterThanOrEqual(0);
            if (phase === 'mine') {
              // The hand in play is lit and in view, clear of the fades.
              const lit = page.locator('[data-testid="my-hand"][data-active="true"]');
              await expect(lit, label).toHaveCount(1);
              await expect(lit, label).toHaveAttribute('data-index', String(active));
              await expect.poll(async () => (await rowShown(page, 'my-hands-row'))?.inView, { message: `${label}: the hand in play in view` }).toBe(true);
            }
          }
        }
        // My turn moving through eight hands, then my hands splitting one at a time up to eight: each hand in play comes into view.
        for (const phase of ['walk', 'splits']) {
          // The test moves the table on (stepMs 0), so a slow check never falls behind the table.
          page = await pages.go(`phase=${phase}&others=5&hands=8&cards=3&allCards=1&stepMs=0`);
          const steps = phase === 'walk' ? 8 : 7;
          for (let step = 0; step < steps; step += 1) {
            const label = `${phase}, step ${step + 1}`;
            if (step > 0) await page.evaluate(() => (window as Window & { harnessNext?: () => void }).harnessNext?.());
            await expect(page.locator('html'), label).toHaveAttribute('data-harness-step', String(step), { timeout: 5000 });
            // While a dealt card is still in the air the row never scrolls past its last hand: the card's
            // flight is not part of the row's width (it once was, and the row overshot, snapped back and
            // left its right fade over the last hand).
            const overshoot = await page.evaluate(async () => {
              const el = document.querySelector<HTMLElement>('[data-testid="my-hands-row"]');
              if (!el) return null;
              let most = 0;
              for (let i = 0; i < 16; i += 1) {
                const box = el.getBoundingClientRect();
                const end = Math.max(...[...el.children].map((c) => c.getBoundingClientRect().right)) - box.left + el.scrollLeft + parseFloat(getComputedStyle(el).paddingRight);
                most = Math.max(most, el.scrollLeft - Math.max(0, end - el.clientWidth));
                await new Promise((done) => setTimeout(done, 50));
              }
              return Math.round(most);
            });
            expect(overshoot, `${label}: the row never scrolls past its last hand`).toBeLessThanOrEqual(1);
            const want = phase === 'walk' ? step : step + 1;
            await expect.poll(async () => { const r = await rowShown(page, 'my-hands-row'); return r && { active: r.active, inView: r.inView, sizes: r.sizes.length }; }, { message: `${label}: the hand in play in view`, timeout: 1300 }).toEqual({ active: want, inView: true, sizes: 1 });
            await nothingScrolls(page, label);
          }
        }
        // Another player's many hands: dealt in, mine keep the stage and theirs stay in their seat.
        page = await pages.go('phase=other&others=5&otherHands=7&active=0&hands=2');
        await expect(page.getByTestId('hand-stage').getByTestId('my-hand')).toHaveCount(2);
        await expect(page.getByTestId('stage-hand')).toHaveCount(0);
        // A watcher sees them on the stage the same way: every hand its cards at one size, the hand in play named and in view.
        for (const [others, otherHands] of [[5, 2], [5, 6], [5, 16], [23, 9], [49, 16]]) {
          page = await pages.go(`phase=other&others=${others}&otherHands=${otherHands}&active=0&watch=1`);
          const label = `another player’s ${otherHands} hands at a table of ${others + 1}, watching`;
          await nothingScrolls(page, label);
          await expect(page.getByTestId('hand-stage')).toHaveAttribute('data-kind', 'turn');
          await expect(page.getByTestId('stage-hand')).toHaveCount(otherHands);
          const stage = await rowShown(page, 'stage-hands-row');
          expect(stage, label).toMatchObject({ hands: otherHands, cards: otherHands * 2, down: false, taller: 0, active: 0, inView: true });
          expect(stage?.sizes, `${label}: one card size`).toHaveLength(1);
          expect(stage?.fade, `${label}: the ends that fade`).toBe(stage?.due);
          await expect(page.getByTestId('stage-owner')).toHaveCount(1);
          await expect.poll(() => allInside(page, 'hand-stage', '[data-testid="stage-owner"]'), { message: `${label}: the name by the hand` }).toEqual({ outside: 0, count: 1 });
          await expect(page.getByTestId('table-turn')).toContainText(`hand 1 of ${otherHands}`);
          await cornersClear(page, label, { dealer: true });
          // The line under the banner (whose turn, which hand, who is next) always shows in full.
          const line = await page.getByTestId('table-turn').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
          expect(line.cw, `${label}: the line under the banner`).toBeGreaterThanOrEqual(line.sw);
        }
        expect(errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  /**
   * The seats' tiles as they show: each one's height, its cards' widths, whether its cards keep clear
   * of its words (the name, the stack, the bet pill, the status) and inside the tile, and every
   * hand's total whole inside its own hand's slot and the tile; with a row of hands (`name`'s), the
   * row: its hands, the hand in play, the ends that fade and should, and whether the hand in play
   * lies inside the row's visible box, clear of its fades (--fade-x, read in px).
   */
  async function tilesShown(page: Page, name = '') {
    return page.evaluate((who) => {
      const meet = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const within = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="seat"]')).map((tile) => {
        const t = tile.getBoundingClientRect();
        const cardsBox = tile.querySelector('.tbl-tile__cards')?.getBoundingClientRect();
        const words = ['.tbl-tile__face', '.tbl-tile__name-text', '[data-testid="seat-chips"]', '[data-testid="seat-bet"]', '[data-testid="seat-pill"]'].map((q) => tile.querySelector(q)?.getBoundingClientRect()).filter((r): r is DOMRect => r !== undefined && r.width > 0 && r.height > 0);
        const cards = Array.from(tile.querySelectorAll('.playing-card')).map((c) => Math.round(c.getBoundingClientRect().width * 2) / 2);
        // A total is whole inside its own slot (its hand's own box), and, scrolled into view or not, inside the tile's height.
        const cut = Array.from(tile.querySelectorAll<HTMLElement>('[data-testid="hand-total"], [data-testid="seat-total"]')).filter((p) => {
          const r = p.getBoundingClientRect();
          // A hand's own total stays off the tile (the tile's big total says it): nothing to cut.
          if (r.width === 0 && r.height === 0) return false;
          if (p.dataset.testid === 'seat-total') return !within(r, t);
          const slot = p.closest('.bj-slot')?.getBoundingClientRect();
          return !slot || !within(r, slot) || r.top < t.top - 0.5 || r.bottom > t.bottom + 0.5;
        }).length;
        // A card is whole: inside the tile's height and the height of every box that clips it (the hands' row).
        const clipped = Array.from(tile.querySelectorAll<HTMLElement>('.playing-card')).filter((c) => {
          const r = c.getBoundingClientRect();
          if (r.top < t.top - 0.5 || r.bottom > t.bottom + 0.5) return true;
          for (let a = c.parentElement; a && a !== tile; a = a.parentElement) {
            if (getComputedStyle(a).overflowY === 'visible') continue;
            const b = a.getBoundingClientRect();
            if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) return true;
          }
          return false;
        }).length;
        return {
          name: tile.dataset.name ?? '',
          height: Math.round(t.height * 10) / 10,
          cards,
          least: cards.length > 0 ? Math.min(...cards) : 0,
          clear: !cardsBox || cardsBox.width === 0 || (within(cardsBox, t) && words.every((w) => !meet(w, cardsBox))),
          cut,
          clipped,
          // The name, the stack, the pill and the status: each wholly inside the tile, none run off its top or its bottom.
          spill: words.filter((w) => !within(w, t)).length,
        };
      });
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="seat"]')).find((t) => t.dataset.name === who)?.querySelector<HTMLElement>('[data-testid="seat-hands-row"]');
      if (!row) return { tiles, row: null };
      const box = row.getBoundingClientRect();
      const fadeX = parseFloat(getComputedStyle(row).getPropertyValue('--fade-x')) || 0;
      const fade = row.dataset.fade ?? '';
      const lit = row.querySelector<HTMLElement>('.bj-hand[data-active="true"]');
      const slot = lit?.closest('.bj-slot')?.getBoundingClientRect();
      const left = row.scrollLeft > 1;
      const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      const sizes = [...new Set(Array.from(row.querySelectorAll('.playing-card')).map((c) => Math.round(c.getBoundingClientRect().width * 2) / 2))];
      return {
        tiles,
        row: {
          hands: row.querySelectorAll('.bj-slot > .bj-hand').length,
          sizes: sizes.length,
          active: lit ? Number(lit.dataset.index) : -1,
          fade,
          due: [left ? 'left' : '', right ? 'right' : ''].filter(Boolean).join(' '),
          // The fade reaches the next hand, never the one in play (0.5px of rounding).
          inView: slot ? slot.left >= box.left + (fade.includes('left') ? fadeX : 0) - 0.5 && slot.right <= box.right - (fade.includes('right') ? fadeX : 0) + 0.5 : null,
          fadeX,
        },
      };
    }, name);
  }

  // A phone's full tiles, two across, once the cards are out: the fan at its 24px floor or more beside the big total, every card,
  // word and total whole inside the tile, the status pill in its header. A seat that stands, one that waits, one on turn and one
  // that bust (three cards, so its fan is wider for the same room); before the deal, the words alone. Where the room has no height
  // for two rows of them, total-only tiles, the same floors kept.
  for (const [size, others, tier] of [
    [{ width: 320, height: 568 }, 2, null],
    [{ width: 360, height: 740 }, 3, null],
    [{ width: 390, height: 844 }, 3, 'full'],
    [{ width: 428, height: 753 }, 3, null],
  ] as const) {
    test(`${size.width}x${size.height}: a phone's tile shows its fan beside a big total, every card at its floor, every word whole`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      try {
        for (const query of [`phase=mine&others=${others}`, `phase=other&others=${others}&turn=1&bustOther=0`, `phase=mine&others=${others}&bustOther=1&start=1000&bet=1250&chips=12500`, `phase=betting&others=${others}`]) {
          const page = await pages.go(query);
          if (tier) await expect(page.getByTestId('seats'), query).toHaveAttribute('data-tier', tier);
          await tilesReadable(page, query);
          await stakesShown(page, query);
          await seatFloors(page, query, 24);
          const { tiles } = await tilesShown(page);
          for (const t of tiles) {
            const label = `${query}: ${t.name}`;
            expect(t, `${label}: the cards clear of the words and every total whole`).toMatchObject({ clear: true, cut: 0, clipped: 0, spill: 0 });
            if (t.cards.length > 0) expect(new Set(t.cards).size, `${label}: one card size`).toBe(1);
          }
        }
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  // A short phone (360x640, 375x667) has no room for even compact tiles' least height under one to four others: the seats take
  // compact tiles (no cards), never full ones squashed under their cards, which cut the cards off at the tile's bottom edge.
  for (const size of [{ width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 700 }]) {
    test(`${size.width}x${size.height}: every seat's cards show whole inside its tile, however few seats`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      try {
        for (const others of [1, 2, 3, 4]) {
          for (const query of [`phase=mine&others=${others}&start=20000&chips=20000`, `phase=other&others=${others}&turn=0&start=20000&chips=20000`]) {
            const page = await pages.go(query);
            const { tiles } = await tilesShown(page);
            for (const t of tiles) expect(t, `${query}: ${t.name}: every card whole`).toMatchObject({ clipped: 0, clear: true, cut: 0 });
          }
        }
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  // A desktop's three full tiles at every common height: the name, the stack, the pill, the status and the cards with their total all
  // inside the tile, a big stack and stake too, and so with a reader's larger text (18px), which wrapped the pill under the stack
  // and pushed the cards and total off the tile's bottom edge.
  test('desktops: a full tile keeps its name, words, cards and total inside it at every height and text size', async ({ browser }) => {
    test.setTimeout(120_000);
    for (const size of [{ width: 1024, height: 700 }, { width: 1100, height: 720 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 800 }, { width: 1920, height: 950 }]) {
      const pages = harnessPages(browser, size);
      try {
        for (const font of ['', '18px']) {
          for (const query of ['phase=mine&others=3&start=150000&chips=150000&bet=41000&stake=41000', 'phase=mine&others=3&start=100000&chips=1250000&bet=49999&stake=49999', 'phase=betting&others=3&start=150000&chips=150000&bet=41000&stake=41000']) {
            const page = await pages.go(query);
            if (font) await page.addStyleTag({ content: `html { font-size: ${font}; }` });
            await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', 'full');
            await page.waitForTimeout(300);
            const { tiles } = await tilesShown(page);
            for (const t of tiles) expect(t, `${size.width}x${size.height} ${font || 'default text'} ${query}: ${t.name}`).toMatchObject({ clipped: 0, cut: 0, spill: 0, clear: true });
            await seatFloors(page, `${size.width}x${size.height} ${font || 'default text'} ${query}`, 32);
          }
        }
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    }
  });

  // Another player's split hands in their tile take the rule my hands have on the stage: every hand its cards at one size with its total,
  // a row that slides to the hand in play (in view, clear of the fades) and fades its ends where more hands wait, no total ever cut, on a
  // phone's narrow tile and a desktop's wide one. The tile, the dealer's row and my hand stay where a seat of one hand leaves them.
  for (const [size, others] of [
    [{ width: 320, height: 568 }, 2],
    [{ width: 390, height: 844 }, 3],
    [{ width: 428, height: 753 }, 2],
    [{ width: 1440, height: 900 }, 3],
  ] as const) {
    test(`${size.width}x${size.height}: another player's split hands slide in their tile to the hand in play, every total whole`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      try {
        let page = await pages.go(`phase=other&others=${others}`);
        const one = await tilesShown(page, 'Pia');
        const fixed = await places(page);
        for (const [hands, active] of [[2, 1], [4, 0], [4, 1], [4, 3]]) {
          const query = `phase=other&others=${others}&otherHands=${hands}&otherActive=${active}`;
          page = await pages.go(query);
          await expect(page.getByTestId('table-turn')).toContainText(`hand ${active + 1} of ${hands}`);
          await tilesReadable(page, query);
          const shown = await tilesShown(page, 'Pia');
          await expect.poll(async () => (await tilesShown(page, 'Pia')).row?.inView, { message: `${query}: the hand in play in view`, timeout: 1300 }).toBe(true);
          const row = (await tilesShown(page, 'Pia')).row;
          expect(row, query).toMatchObject({ hands, sizes: 1, active });
          expect(row?.fade, `${query}: the ends that fade`).toBe(row?.due);
          for (const [i, t] of shown.tiles.entries()) {
            expect(t, `${query}: ${t.name}`).toMatchObject({ clear: true, cut: 0 });
            expect(t.height, `${query}: ${t.name} as tall as with one hand`).toBe(one.tiles[i].height);
          }
          const now = await places(page);
          expectSame(`${query}: the dealer`, now.dealer, fixed.dealer);
          expectSame(`${query}: my hand`, now.mine, fixed.mine);
        }
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: my next stake, a soft total and a long wait all read in full`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        // My bet goes down while the last round's hands are still on the table: it never covers a card, and stays on the stage.
        for (const hands of [1, 2, 3, 9]) {
          await open(page, `phase=results&others=5&hands=${hands}&myBet=10`);
          await expect(page.getByTestId('my-bet')).toHaveAttribute('data-bet', '10');
          const overlaps = await page.evaluate(() => {
            const bet = document.querySelector('[data-testid="my-bet"]')?.getBoundingClientRect();
            if (!bet) return -1;
            return Array.from(document.querySelectorAll('[data-testid="my-area"] :is([data-testid="card"], [data-testid="my-slot"], [data-testid="hand-total"])')).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < bet.right && r.right > bet.left && r.top < bet.bottom && r.bottom > bet.top;
            }).length;
          });
          expect(overlaps, `${hands} hands: my bet over the table`).toBe(0);
          await expect.poll(() => allInside(page, 'hand-stage', '[data-testid="my-bet"]'), { message: `${hands} hands: my bet on the stage` }).toEqual({ outside: 0, count: 1 });
        }
        // A long word beside a total (a big payout, a doubled stake) keeps to the room my row leaves: nothing scrolls, no hand outgrows the row.
        for (const query of ['phase=results&hands=1&stake=1000', 'phase=results&hands=2&stake=1000&doubled=1', 'phase=mine&hands=1&stake=1000&doubled=1&cards=3', 'phase=mine&hands=3&active=1&stake=1000&doubled=1']) {
          await open(page, `others=5&${query}`);
          if (query.startsWith('phase=results')) await expect(page.getByTestId('my-area').getByTestId('hand-outcome').first()).toHaveText('Win');
          await nothingScrolls(page, query);
          await expect.poll(() => allInside(page, 'my-area', '[data-testid="my-hand"], [data-testid="hand-total"]'), { message: `${query}: every hand inside my row` }).toMatchObject({ outside: 0 });
          // The words beside the pill stay on the table, over the hand's own slot.
          await expect.poll(() => allInside(page, 'hand-stage', '.tbl-hand__head'), { message: `${query}: the words beside each total on the stage` }).toMatchObject({ outside: 0 });
          // The outcome word ("Win +2,000") is a chip on the pill's own line: never lower than the pill, so the card's edge never cuts its letters.
          const flags = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-testid="hand-stage"] .tbl-hand__head .tbl-flag')).map((flag) => {
              const pill = flag.parentElement?.querySelector('.tbl-pill')?.getBoundingClientRect();
              const word = flag.getBoundingClientRect();
              const ground = getComputedStyle(flag).backgroundColor;
              return { below: pill ? word.bottom - pill.bottom : 99, grounded: ground !== 'rgba(0, 0, 0, 0)' && ground !== 'transparent' };
            }),
          );
          for (const f of flags) {
            expect(f.below, `${query}: the outcome word no lower than the pill`).toBeLessThanOrEqual(1);
            expect(f.grounded, `${query}: the outcome word on its own ground`).toBe(true);
          }
        }
        // A soft total ("10/20") stays inside its pill.
        await open(page, 'phase=mine&others=5&hands=1&active=0&soft=1');
        const soft = page.getByTestId('my-area').getByTestId('hand-total');
        await expect(soft).toHaveText('10/20');
        const pill = await soft.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(pill.sw, 'the soft total fits its pill').toBeLessThanOrEqual(pill.cw);
        // The same soft total on another player's turn: my hand keeps its place and size, the total inside my row.
        await open(page, 'phase=other&others=5&hands=1&active=0&soft=1');
        await expect(page.getByTestId('my-area').getByTestId('hand-total')).toHaveText('10/20');
        await nothingScrolls(page, "a soft total on another player’s turn");
        await expect.poll(() => allInside(page, 'my-area', '[data-testid="my-hand"], [data-testid="hand-total"]'), { message: "a soft total on another player’s turn" }).toMatchObject({ outside: 0 });
        // Long names: the count of bets in always shows, and the wait reads in full.
        await open(page, 'phase=betting&others=3&myBet=10&names=Pia,Bartholomew,Christabel');
        const count = page.getByTestId('bets-count');
        await expect(count).toHaveText('2 of 4 bets in');
        const shown = await count.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const parent = el.parentElement?.getBoundingClientRect();
          return { width: r.width, parent: parent?.width ?? 0, sw: el.scrollWidth };
        });
        expect(shown.parent, 'the count has its room').toBeGreaterThanOrEqual(shown.sw);
        const waiting = page.getByTestId('table-turn').locator('.tbl-turn__text');
        await expect(waiting).toHaveText('Waiting for 2 players');
        const status = await waiting.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(status.sw, 'the line in full').toBeLessThanOrEqual(status.cw);
      } finally {
        await ctx.close();
      }
    });
  }

  // Split hands side by side on a phone: my stake by each total (its chips and the figure) keeps to the width the word Bet gave it,
  // so two hands at 320px and three at 414px share the row without scrolling it (the old "Bet 1,200" once pushed one out).
  for (const [size, hands, stakes] of [
    [{ width: 320, height: 568 }, 2, ['stake=10&start=1000', 'stake=200&start=1000', 'stake=990&start=1000', 'stake=600&doubled=1&start=1000', 'stake=740&doubled=1&start=1000', 'stake=4990&start=1000', 'stake=1200&start=10000', 'stake=2900&start=10000']],
    [{ width: 414, height: 896 }, 3, ['stake=200&start=1000', 'stake=990&start=1000', 'stake=200&doubled=1&start=10000']],
  ] as const) {
    test(`${size.width}x${size.height}: ${hands} split hands stay side by side whatever my stake`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        for (const stake of stakes) {
          const query = `phase=mine&others=3&hands=${hands}&${stake}`;
          await open(page, query);
          await expect.poll(async () => (await rowShown(page, 'my-hands-row'))?.sideways, { message: `${query}: every hand in view, the row not scrolling` }).toBe(false);
          await expect(page.getByTestId('hand-bet')).toHaveCount(hands);
          await nothingScrolls(page, query);
          await expect.poll(() => allInside(page, 'hand-stage', '.tbl-hand__head'), { message: `${query}: each stake and total on the stage` }).toMatchObject({ outside: 0, count: hands });
        }
      } finally {
        await ctx.close();
      }
    });
  }

  // Narrow total-only tiles (five to nine players on a 320px phone, ten on a 390px or 414px one), or a crowd's where they have no
  // room: every seat's stack, total and bet that shows reads in full and apart.
  for (const [size, tables] of [
    [{ width: 320, height: 568 }, [4, 5, 6, 7, 8]],
    [{ width: 390, height: 844 }, [9]],
    [{ width: 414, height: 896 }, [9]],
  ] as const) {
    test(`${size.width}x${size.height}: a narrow compact tile keeps its stack, total and bet apart`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        for (const others of tables) {
          for (const [bet, chips] of [[10, 990], [200, 800], [1300, 9800]]) {
            const query = `phase=other&others=${others}&start=1000&bet=${bet}&chips=${chips}&otherHands=2`;
            await open(page, query);
            // Total-only tiles, or a crowd's where two rows of them have no height (a 320px phone): every total shows.
            await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', /^(compact|small)$/);
            await expect(page.getByTestId('seat-total')).toHaveCount(others);
            await stakesShown(page, query);
            await tilesReadable(page, query);
          }
        }
        // The bets going down, no total yet: a six-figure stack ("150k chips") has the whole line and keeps whole.
        const query = `phase=betting&others=${tables[tables.length - 1]}&start=100000&bet=9000&chips=150000`;
        await open(page, query);
        await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', /^(compact|small)$/);
        await expect(page.getByTestId('seat-total')).toHaveCount(0);
        await stakesShown(page, query);
        await tilesReadable(page, query);
      } finally {
        await ctx.close();
      }
    });
  }

  // The cards on a phone take the room the seats leave (room.ts useSeatRoom), as many seats as the round was dealt with: a small
  // table on the owner's 390x844 phone gets big cards (55.5px when they went by the table's height alone, 60px for a watcher),
  // up to where the dealer's four and a shoe their own size still fit beside each other (61.9px; 69.6px at 430 wide); three
  // others there take two rows of full tiles, two across, so their cards read, and leave mine the least card,
  // a table of twelve or more keeps the tiles it had (small at 390x844, compact at 430x932), and where it needs all its room
  // the least card. Twelve at 390x844 leave the cards 1px (`spare`): their small tiles take their 158px and the 8px kept over
  // them, and the two rows, at the least card a pill's height and 1.67 card widths tall each, leave 167.95px, just under the
  // 168px compact tiles would need, so 0.3px of card (3.34px of the rows a card pixel) over the least. A watcher's table is
  // taller by the bet controls: its seats have that room first, the cards what they leave.
  // Every stack is four digits ("1,250 chips"), as a table's are from the default 1,000. On the narrowest phone three full tiles
  // across were 93px and cut it to "1,250 chip": three others there sit on compact tiles (or, for a watcher with the height, two
  // rows of full ones), every stack whole, in every phase.
  for (const [size, cases] of [
    [
      { width: 320, height: 568 },
      [
        { others: 3, watch: false, phase: 'betting', tier: 'compact', least: 45 },
        { others: 3, watch: false, phase: 'mine', tier: 'compact', least: 45 },
        { others: 3, watch: false, phase: 'results', tier: 'compact', least: 45 },
        { others: 3, watch: true, phase: 'other', tier: 'full', least: 0 },
        { others: 5, watch: true, phase: 'other', tier: 'compact', least: 45 },
        { others: 5, watch: true, phase: 'results', tier: 'compact', least: 45 },
      ],
    ],
    [
      { width: 390, height: 844 },
      [
        { others: 1, watch: false, tier: 'full', least: 61.5 },
        { others: 3, watch: false, tier: 'full', least: 0 },
        { others: 5, watch: false, tier: 'compact', least: 60 },
        { others: 11, watch: false, tier: 'small', least: 0, spare: 1 },
        { others: 23, watch: false, tier: 'small', least: 0 },
        { others: 49, watch: false, tier: 'dense', least: 0 },
        { others: 2, watch: true, tier: 'full', least: 61.5 },
        { others: 12, watch: true, tier: 'compact', least: 60 },
      ],
    ],
    [
      { width: 430, height: 932 },
      [
        { others: 1, watch: false, tier: 'full', least: 69 },
        { others: 11, watch: false, tier: 'compact', least: 60 },
        { others: 49, watch: false, tier: 'dense', least: 60 },
      ],
    ],
  ] as const) {
    test(`${size.width}x${size.height}: the cards take the room the seats leave: big at a small table, and a big table keeps its tiles`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        for (const { others, watch, tier, least, ...rest } of cases) {
          const phase = 'phase' in rest ? rest.phase : watch ? 'other' : 'mine';
          const spare = 'spare' in rest ? rest.spare : 0;
          const query = `phase=${phase}&others=${others}&hands=1&active=0${watch ? '&watch=1' : ''}&stake=100&bet=50&chips=1250`;
          await open(page, query);
          await expect(page.getByTestId('bj-table'), query).toHaveAttribute('data-seats', String(others));
          await expect(page.getByTestId('seats'), query).toHaveAttribute('data-tier', tier);
          if (least > 0) await expect.poll(() => cardWidth(page), { message: `${query}: the cards` }).toBeGreaterThanOrEqual(least);
          else {
            // The least card, but for the whole pixels the seats leave (blackjack.css: 3.34px of the two rows a card pixel).
            await expect.poll(() => page.getByTestId('bj-table').evaluate((el) => getComputedStyle(el).getPropertyValue('--tbl-spare')), { message: `${query}: the room the seats leave` }).toBe(`${spare}px`);
            const base = await page.getByTestId('bj-table').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--bj-card-base')));
            await expect.poll(() => cardWidth(page), { message: `${query}: the least card` }).toBe(Math.round((base + spare / 3.34) * 10) / 10);
          }
          await nothingScrolls(page, query);
          // A phone's full and compact tiles show every stack and bet; the small and dense ones never did.
          if (tier === 'full' || tier === 'compact') await stakesShown(page, query);
          await tilesReadable(page, query);
        }
      } finally {
        await ctx.close();
      }
    });
  }

  // A host who watches keeps the row of table buttons all game long: Skip in the turns, Deal now (dimmed until a bet is down) through
  // the dealer's reveal and the next bets. Their panel never changes height, so the felt over it, whose room a phone's cards go by, never
  // grows in a round: the reveal once took Skip away, the felt grew 39px, and the cards went from 60px to 67.9px at 390x844 with seven
  // others (64.4px at 360x740 with five), the dealer's row and the stage with them.
  for (const [size, others] of [
    [{ width: 390, height: 844 }, 7],
    [{ width: 360, height: 740 }, 5],
    [{ width: 390, height: 844 }, 2],
  ] as const) {
    test(`${size.width}x${size.height}, ${others} others: a watching host's panel, cards and places hold from a player's turn through the dealer's reveal`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        const html = page.locator('html');
        const screen = page.getByTestId('blackjack-screen');
        const read = async () => ({ ...(await places(page)), panel: await boxOf(page, 'bj-panel'), card: await cardWidth(page) });
        await open(page, `phase=dealer&watch=1&others=${others}&chips=1250&stepMs=3000`);
        // The last other player's turn: the host may Skip it.
        await expect(html).toHaveAttribute('data-harness-step', '0');
        await expect(page.getByTestId('skip-turn')).toBeEnabled();
        const turn = await read();
        await nothingScrolls(page, 'the turn');
        await tilesReadable(page, 'the turn');
        // The round settles and the dealer's cards turn over: nothing may go, the row stays, dimmed.
        await expect(html).toHaveAttribute('data-harness-step', '1', { timeout: 10_000 });
        await expect(page.getByTestId('deal-now-off')).toBeDisabled();
        await expect(page.getByTestId('skip-turn')).toHaveCount(0);
        const reveal = await read();
        // The outcomes shown, the next bets open (none down yet): the same row.
        await expect(screen).toHaveAttribute('data-busy', 'false', { timeout: 10_000 });
        await expect(page.getByTestId('deal-now-off')).toBeDisabled();
        const results = await read();
        for (const [phase, now] of [['the reveal', reveal], ['the next bets', results]] as const) {
          expectSame(`${phase}: the panel`, turn.panel, now.panel);
          expectSame(`${phase}: the dealer’s hand`, turn.dealer, now.dealer);
          expectSame(`${phase}: the stage`, turn.mine, now.mine);
          expect(now.card, `${phase}: the cards`).toBe(turn.card);
        }
        await nothingScrolls(page, 'the next bets');
        await tilesReadable(page, 'the next bets');
      } finally {
        await ctx.close();
      }
    });
  }

  /** What `selector` shows (its visible text: the short or the full figure, never both), for each match. */
  const shownText = (page: Page, selector: string): Promise<string[]> => page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

  // Big stakes on full tiles (two players on a phone, four on a 1024px desktop, five on a 1280px one): the stack and the bet share
  // the footer's line, clear of the name.
  for (const [size, others] of [
    [{ width: 360, height: 740 }, 1],
    [{ width: 390, height: 844 }, 1],
    [{ width: 1024, height: 768 }, 3],
    [{ width: 1280, height: 800 }, 4],
  ] as const) {
    test(`${size.width}x${size.height}: a full tile keeps a big stake on the stack’s line, clear of the name`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        for (const phase of ['betting', 'other']) {
          for (const money of ['start=100000&bet=12000&chips=88000', 'start=100000&bet=9000&chips=150000', 'start=100000&bet=49999&chips=150001', 'start=10000&bet=4900&chips=17600']) {
            const query = `phase=${phase}&others=${others}&${money}`;
            await open(page, query);
            await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', 'full');
            await stakesShown(page, query);
            await tilesReadable(page, query);
            const apart = await page.evaluate(() =>
              Array.from(document.querySelectorAll('[data-testid="seat"]')).flatMap((tile) => {
                const stack = tile.querySelector('[data-testid="seat-chips"]')?.getBoundingClientRect();
                const pill = tile.querySelector('[data-testid="seat-bet"]')?.getBoundingClientRect();
                return stack && pill ? [Math.abs(stack.top + stack.height / 2 - (pill.top + pill.height / 2))] : [];
              }),
            );
            expect(apart.length, `${query}: a pill to measure`).toBeGreaterThan(0);
            for (const d of apart) expect(d, `${query}: the stack and the pill on one line`).toBeLessThan(3);
          }
        }
      } finally {
        await ctx.close();
      }
    });
  }

  // My stake by a hand: a hand on its own has the room for three chips and the figure in full ("1,250", "12,000", never "1.3k" or "12k"),
  // on a phone, a tablet and a desktop (a desktop's seats beside it read "40,500" in full too), and so has my next stake by my empty
  // places; only split hands side by side on a phone's stage pack it to two chips and the short figure. A figure too long for the stage
  // ("1,250,000" beside my empty places) reads short rather than run off it, measured again once the cards have grown into the room the
  // seats leave (on a 412x915 phone the full figure fit the stage at the least card, and sat 2px off it at the 81px card).
  for (const size of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: a hand on its own keeps its stake in full, split hands read it short under their cards`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      try {
        let page = await pages.go('phase=mine&others=3&hands=1&stake=1250&start=1000');
        await expect.poll(() => shownText(page, '[data-testid="hand-bet"]')).toEqual(['1,250']);
        page = await pages.go('phase=betting&others=3&myBet=1250&start=1000');
        await expect.poll(() => shownText(page, '[data-testid="my-bet"]')).toEqual(['1,250']);
        page = await pages.go('phase=mine&others=3&hands=1&stake=200&start=1000');
        await expect.poll(() => page.locator('[data-testid="hand-bet"] .tbl-stake__chip:visible').count(), { message: 'three chips by a hand on its own' }).toBe(3);
        page = await pages.go('phase=mine&others=3&hands=2&stake=1250&start=1000');
        await expect.poll(async () => (await rowShown(page, 'my-hands-row'))?.sideways).toBe(false);
        // Split hands, on any screen: each stake a small chip under its cards, short.
        await expect.poll(() => shownText(page, '[data-testid="hand-bet"]')).toEqual(['1.3k', '1.3k']);
        // A 100,000 table: "12,000" by my hand and by my empty places (its figure, after three chips and a plus), in every phase my stake
        // is out, as the seats' pills read beside it.
        for (const phase of ['mine', 'other', 'deal']) {
          page = await pages.go(`phase=${phase}&others=3&hands=1&stake=12000&start=100000&bet=40500&chips=88000`);
          await expect.poll(() => shownText(page, '[data-testid="hand-bet"] .tbl-stake__value'), { message: `${phase}: my stake` }).toEqual(['12,000']);
          await expect.poll(() => allInside(page, 'hand-stage', '.tbl-hand__head > *', 0.5), { message: `${phase}: my stake on the stage` }).toMatchObject({ outside: 0 });
        }
        // The seats beside it say their bet short on their footer ("bet 41k"), where the tile has the room for it.
        if (size.width > 1024) expect(await shownText(page, '[data-testid="seat"] [data-testid="seat-bet"]'), 'the seats beside it').toContain('bet 41k');
        page = await pages.go('phase=betting&others=3&myBet=12000&start=100000');
        await expect.poll(() => shownText(page, '[data-testid="my-bet"] .tbl-stake__value')).toEqual(['12,000']);
        // Seven figures beside my empty places: in full where the stage has the room, short where it would run off it; on the stage either way.
        page = await pages.go('phase=betting&others=3&myBet=1250000&start=100000');
        await expect.poll(() => allInside(page, 'hand-stage', '[data-testid="my-bet"]', 0.5), { message: 'seven figures beside my empty places' }).toEqual({ outside: 0, count: 1 });
        expect(['1,250,000', '1.3M']).toContain((await shownText(page, '[data-testid="my-bet"] .tbl-stake__value'))[0]);
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  // A seat's sheet on a 320px phone: the stack, a pill of chips and the seat's line once overran the sheet ("Playin"); the line wraps under them.
  test('320x568: a seat sheet keeps its stack, stake and line inside it', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await ctx.newPage();
    try {
      for (const money of ['start=10000&bet=4000&chips=19000', 'start=100000&bet=4000&chips=88000']) {
        await open(page, `phase=other&others=8&otherHands=3&${money}`);
        await page.locator('[data-testid="seat"][data-name="Pia"] [data-testid="seat-open"]').click();
        const line = page.getByTestId('seat-detail').locator('p').first();
        await expect(line).toBeVisible();
        const fit = await line.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return { over: el.scrollWidth - el.clientWidth, outside: Array.from(el.children).filter((c) => c.getBoundingClientRect().right > box.right + 0.5).map((c) => c.textContent) };
        });
        expect(fit, `${money}: the sheet's line inside it`).toEqual({ over: 0, outside: [] });
        await expect(line).toContainText('Playing');
      }
    } finally {
      await ctx.close();
    }
  });

  // Split hands' totals on a compact tile: joined ("18/17") on a desktop's tiles and a phone's three across alike.
  for (const [size, others, joined] of [
    [{ width: 1440, height: 900 }, 8, true],
    [{ width: 1024, height: 768 }, 8, true],
    [{ width: 390, height: 844 }, 6, true],
  ] as const) {
    test(`${size.width}x${size.height}: a compact tile ${joined ? 'joins split hands\' totals' : 'shows the hand in play\'s total'}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        const query = `phase=other&others=${others}&otherHands=2`;
        await open(page, query);
        await expect(page.getByTestId('seats')).toHaveAttribute('data-tier', 'compact');
        const [total] = await shownText(page, '[data-testid="seat"][data-turn="true"] [data-testid="seat-total"]');
        expect(total, query).toMatch(joined ? /^\d+\/\d+$/ : /^\d+$/);
        await tilesReadable(page, query);
      } finally {
        await ctx.close();
      }
    });
  }

  // My cards' corners, and the dealer's, read whole in every phase of a round (the bets, the deal, my turn, another player's, the
  // dealer's play, the results and the final table), with a hand on its own (a "10", the widest corner, under a 12,000 stake read in
  // full; an ace and a king) and two split hands side by side, at every phone size, a tablet and a desktop, and the dealer's row and
  // the stage keep their places through it all. A "+12k" pill once covered the top of my 10's "10" on a 360px phone, and "Blackjack
  // +125" my ace's "A".
  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: every rank and suit of my cards reads whole in every phase, and the places hold`, async ({ browser }) => {
      test.setTimeout(120_000);
      const pages = harnessPages(browser, size);
      try {
        for (const mine of ['hands=1&hand=10H,6H', 'hands=1&hand=AD,KC', 'hands=2&allCards=1&cards=3&hand=10H,6H&active=1']) {
          let ref: { dealer: Box; mine: Box } | null = null;
          for (const phase of ['betting', 'deal', 'mine', 'other', 'dealer', 'results', 'over']) {
            const page = await pages.go(`phase=${phase}&others=3&start=100000&stake=12000&myBet=12000&chips=88000&bet=40500&stepMs=300&${mine}`);
            const label = `${mine}, ${phase}`;
            // The deal and the dealer's play animate a second snapshot: read the table once it is on.
            if (phase === 'deal' || phase === 'dealer') await expect(page.locator('html')).toHaveAttribute('data-harness-step', '1');
            await nothingScrolls(page, label);
            await cornersClear(page, label, { dealer: true });
            await expect.poll(() => allInside(page, 'hand-stage', '.tbl-hand__head > *, .bj-empty__stake', 0.5), { message: `${label}: the words by my hands on the stage` }).toMatchObject({ outside: 0 });
            const now = await places(page);
            if (ref === null) ref = now;
            expectSame(`${label}: the dealer’s hand`, ref.dealer, now.dealer);
            expectSame(`${label}: the stage`, ref.mine, now.mine);
          }
        }
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  // Six- and seven-figure stacks (a 100,000 table's) and a big payout on the seats' tiles, in every tier a table of 2 to 10 takes at every
  // phone width and on a desktop: every stack and seat line reads whole, short ("100k chips", "Win +81k", "Win") only where the full one
  // cannot fit, and every badge on an avatar keeps clear of the figures beside it (tilesReadable). "100,000 chips" was cut on a full tile
  // three across a 360px phone, its ellipsis never drawn; "1,250,000 chips" and a pill of chips and a plus rose under the name on a full
  // tile before the deal; a tick ran into "1,150 chips" on a desktop's final table.
  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: every stack and seat line reads whole, short only where the full one cannot fit`, async ({ browser }) => {
      test.setTimeout(120_000);
      const pages = harnessPages(browser, size);
      try {
        const forms = (chips: number) => [chips < 10_000 ? chips.toLocaleString('en-US') : chips >= 1_000_000 ? `${Math.round(chips / 100_000) / 10}M` : `${Math.round(chips / 1000)}k`];
        for (const others of [1, 3, 5, 9]) {
          for (const chips of [100_000, 1_250_000]) {
            for (const phase of ['betting', 'results']) {
              const query = `phase=${phase}&others=${others}&start=100000&chips=${chips}&bet=40500&stake=12000`;
              const page = await pages.go(query);
              const tier = await page.getByTestId('seats').getAttribute('data-tier');
              // Full and compact tiles show every stack and bet, but for a compact tile 46px tall or less (ten players on a small phone),
              // which keeps the name and the total alone (table.css).
              const tall = (await page.getByTestId('seat').first().evaluate((el) => el.getBoundingClientRect().height)) > 46;
              if (tier === 'full' || (tier === 'compact' && tall)) await stakesShown(page, query);
              await tilesReadable(page, query);
              // A stack on a full tile reads in full under 10,000 and short above ("100k", "1.3M"), never cut; the crowd tiers have their own forms.
              if (tier === 'full') for (const text of await shownText(page, '[data-testid="seat-chips"]')) expect(forms(chips), `${query}: a stack`).toContain(text);
            }
          }
        }
        // The final table the host ended, on a desktop: a tick or a cross beside each "1,150 chips".
        const page = await pages.go('phase=over&others=5&start=1000&chips=1150&bet=150&stake=200');
        await tilesReadable(page, 'the final table');
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }

  // Two split hands on the least cards (30px: a 320x568 phone with twenty-four or forty-nine others) with the same words over each (a 12,000
  // stake and the total), through the deal and in every phase after it: each hand's stake and total stay on the stage. The room a slot
  // keeps before its cards was 3px short (the words end 3px inside the hand's box, at its fan's right edge), and while both hands' words
  // were the row's widest, the first hand's "+ 12k" settled 2.6px off the stage's left edge.
  test('320x568: two split hands on the least cards keep their stakes on the stage through the deal', async ({ browser }) => {
    const pages = harnessPages(browser, { width: 320, height: 568 });
    try {
      for (const others of [24, 49]) {
        for (const phase of ['deal', 'mine', 'other', 'results']) {
          const query = `phase=${phase}&others=${others}&hands=2&cards=2&stake=12000&start=100000&bet=12000&chips=88000&hand=10H,6H&stepMs=300`;
          const page = await pages.go(query);
          if (phase === 'deal') await expect(page.locator('html')).toHaveAttribute('data-harness-step', '1');
          await expect.poll(async () => (await rowShown(page, 'my-hands-row'))?.sideways, { message: `${query}: both hands in view` }).toBe(false);
          await expect.poll(() => cardWidth(page), { message: `${query}: the least card` }).toBe(30);
          await expect.poll(() => allInside(page, 'hand-stage', '.tbl-hand__head > *, .tbl-hand__head .tbl-stake', 0.5), { message: `${query}: the words over each hand on the stage` }).toMatchObject({ outside: 0 });
          await cornersClear(page, query);
        }
      }
      expect(pages.errors).toEqual([]);
    } finally {
      await pages.close();
    }
  });

  // Two split hands with one other player at 412x915 (and 390x844), one of them long (five or six cards): each hand's stake and total
  // stay on the stage, not even a pixel past its edge, whatever the stake. Its room measured by the row's longest hand, a two-card
  // hand's stake once ran up to 23px off the stage's left edge beside a five- or six-card one.
  for (const size of [{ width: 412, height: 915 }, { width: 390, height: 844 }]) {
    test(`${size.width}x${size.height}: a long split hand beside a short one keeps every stake and total on the stage`, async ({ browser }) => {
      const pages = harnessPages(browser, size);
      try {
        for (const money of ['start=1000&stake=10', 'start=1000&stake=1250', 'start=100000&stake=12000', 'start=1000&stake=600&doubled=1', 'start=10000&stake=4990']) {
          for (const [cards, layout] of [[5, 'active=1'], [6, 'active=1'], [5, 'active=0&allCards=1']] as const) {
            for (const phase of ['mine', 'results']) {
              const query = `phase=${phase}&others=1&hands=2&cards=${cards}&${layout}&${money}`;
              const page = await pages.go(query);
              await expect(page.getByTestId('my-hand'), query).toHaveCount(2);
              await expect.poll(() => allInside(page, 'hand-stage', '.tbl-hand__head > *, .tbl-hand__head .tbl-stake', 0.5), { message: `${query}: the words over each hand on the stage` }).toMatchObject({ outside: 0 });
              await cornersClear(page, query);
            }
          }
        }
        expect(pages.errors).toEqual([]);
      } finally {
        await pages.close();
      }
    });
  }
});
