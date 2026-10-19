import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { locationsForMode } from '../shared/games/spygame/locations';
import { closeResults, createParty, enterNameIfAsked, expectRulesReadCleanly, gameBarFits, menuSheetFits, openPlayers, readyAll } from './party';

/**
 * A whole two-round Spy Game between a desktop host and two phones (390x844, touch): roles, the
 * shared location, the spy's grid (three columns of eight on a phone, every place in view), a
 * wrong guess, a failed vote, a passed vote, the reveal, a correct guess in round two and the
 * results in the lobby. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
/** The narrower phones How to play is read at too. */
const NARROW = [{ width: 360, height: 740 }, { width: 320, height: 568 }];
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
let roomCode = '';
/** Round one's cast. */
let spy: Player;
let agents: Player[] = [];
let locationId = '';

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

async function roleOf(p: Player): Promise<string> {
  return (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? '';
}

/** Round one's cast from the role markers: exactly one spy, everyone else an agent. */
async function castOf(): Promise<{ spy: Player; agents: Player[] }> {
  const roles = await Promise.all(players.map(roleOf));
  const spies = players.filter((_, i) => roles[i] === 'spy');
  expect(spies).toHaveLength(1);
  return { spy: spies[0], agents: players.filter((_, i) => roles[i] === 'agent') };
}

/** The header ring: the round clock, counting the vote or the next round while the round clock waits (the one countdown on screen). */
function clock(p: Player): Locator {
  return p.page.getByTestId('spygame-header').getByTestId('timer');
}

function guessTile(p: Player, id: string): Locator {
  return p.page.locator(`[data-testid="guess-tile"][data-location-id="${id}"]`);
}

function accuseRow(p: Player, name: string): Locator {
  return p.page.locator(`[data-testid="accuse-row"][data-name="${name}"]`);
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

/**
 * Runs `check` with the page at phone size. The spy is drawn at random, so the phone-layout
 * assertions must not depend on which player (the desktop host included) is drawn.
 */
/**
 * At `size`, with the page and the game's column scrolled to the top, every place tile of `testId`
 * lies wholly inside the viewport, reads at 11px or more on at most two lines, and is `minHeight` tall.
 */
async function allPlacesInView(p: Player, testId: string, size: { width: number; height: number }, minHeight: number): Promise<void> {
  const before = p.page.viewportSize() ?? DESKTOP;
  await p.page.setViewportSize(size);
  try {
    await expect(p.page.locator('.spy--phone')).toBeVisible();
    const measure = () =>
      p.page.evaluate((id) => {
        window.scrollTo(0, 0);
        const main = document.querySelector<HTMLElement>('[data-testid="spygame-main"]');
        if (main) main.scrollTop = 0;
        const tiles = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
        const boxes = tiles.map((t) => t.getBoundingClientRect());
        const names = tiles.map((t) => t.querySelector<HTMLElement>('.spy-tile__name'));
        return {
          count: tiles.length,
          scrolled: window.scrollY + (main?.scrollTop ?? 0),
          outside: boxes.filter((r) => r.top < 0 || r.left < 0 || r.bottom > window.innerHeight + 0.5 || r.right > window.innerWidth + 0.5).length,
          small: names.filter((n) => !n || parseFloat(getComputedStyle(n).fontSize) < 11).length,
          clipped: names.filter((n) => !n || n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1).length,
          lowest: Math.min(...boxes.map((r) => r.height)),
        };
      }, testId);
    await expect.poll(measure, { message: `${p.name}: every place in view at ${size.width}x${size.height}` }).toMatchObject({ count: 24, scrolled: 0, outside: 0, small: 0, clipped: 0 });
    expect((await measure()).lowest, `${p.name}: every place tile is at least ${minHeight}px tall at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(minHeight);
  } finally {
    await p.page.setViewportSize(before);
  }
}

async function atPhoneSize(p: Player, check: () => Promise<void>): Promise<void> {
  const before = p.page.viewportSize() ?? DESKTOP;
  await p.page.setViewportSize(PORTRAIT);
  try {
    await check();
  } finally {
    await p.page.setViewportSize(before);
  }
}

/**
 * Every screen the place grids are checked on: upright and sideways phones, tablets both ways up
 * and desktops, 320 to 1920 wide.
 */
const GRID_SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 430, height: 932 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 900, height: 1200 },
  { width: 1024, height: 768 },
  { width: 1024, height: 1366 },
  { width: 1180, height: 820 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

/** Every place of the family pack: the round's 24 are a draw from it, so every tile is checked with every name. */
const FAMILY_PLACES = locationsForMode('family').map((l) => l.name);

/**
 * At every size in GRID_SIZES, every place tile of `testId` shows its name whole: some of it in view,
 * no word cut at its side or broken inside itself (a line of "Kindergarte"), no line clamped away,
 * and none of it under the tile's mark (the agents' tick on the real place). The round's places
 * first, then every place of the family pack written into every tile (and put back), so no draw
 * misses a long name.
 */
async function everyNameWhole(p: Player, testId: string): Promise<void> {
  const before = p.page.viewportSize() ?? DESKTOP;
  try {
    for (const size of GRID_SIZES) {
      await p.page.setViewportSize(size);
      const cut = () =>
        p.page.evaluate(
          ({ id, places }) => {
            const out = new Set<string>();
            const range = document.createRange();
            const check = (tile: HTMLElement, name: HTMLElement) => {
              const text = name.textContent ?? '';
              const r = name.getBoundingClientRect();
              // A whole number of pixels either way: a fractional line box rounds scrollHeight up by one, a clamped third line adds a dozen.
              if (r.width < 8 || name.scrollWidth > name.clientWidth + 0.5 || name.scrollHeight > name.clientHeight + 1) out.add(`${text} is cut (${Math.round(r.width)}px)`);
              const node = name.firstChild;
              if (!node) return;
              // A word whose letters sit on more than one line was broken inside itself.
              let at = 0;
              for (const word of text.split(' ')) {
                range.setStart(node, at);
                range.setEnd(node, at + word.length);
                if (new Set([...range.getClientRects()].filter((g) => g.width > 0).map((g) => Math.round(g.top))).size > 1) out.add(`"${word}" breaks inside itself in ${text}`);
                at += word.length + 1;
              }
              const mark = tile.querySelector('.spy-tile__mark')?.getBoundingClientRect();
              if (!mark) return;
              // The mark is a disc: none of it on any letter's own box (a space that hangs past a wrapped line's end is no ink).
              const [cx, cy, radius] = [(mark.left + mark.right) / 2, (mark.top + mark.bottom) / 2, mark.width / 2];
              for (let i = 0; i < text.length; i++) {
                if (/\s/.test(text[i] ?? '')) continue;
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                for (const glyph of range.getClientRects()) {
                  const nearest = Math.hypot(Math.max(glyph.left, Math.min(cx, glyph.right)) - cx, Math.max(glyph.top, Math.min(cy, glyph.bottom)) - cy);
                  if (nearest < radius - 0.5) out.add(`the mark covers ${text}`);
                }
              }
            };
            const tiles = [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)].map((tile) => ({ tile, name: tile.querySelector<HTMLElement>('.spy-tile__name') }));
            if (tiles.some(({ name }) => !name)) return ['a tile with no name'];
            const named = tiles as { tile: HTMLElement; name: HTMLElement }[];
            for (const { tile, name } of named) check(tile, name);
            const own = named.map(({ name }) => name.textContent);
            for (const place of places) {
              for (const { name } of named) name.textContent = place;
              for (const { tile, name } of named) check(tile, name);
            }
            named.forEach(({ name }, i) => (name.textContent = own[i]));
            return [...out].slice(0, 12);
          },
          { id: testId, places: FAMILY_PLACES },
        );
      await expect.poll(cut, { message: `${p.name}: every place name whole at ${size.width}x${size.height}` }).toEqual([]);
    }
  } finally {
    await p.page.setViewportSize(before);
  }
}

/** Reads a score from the platform player list, which lives in the scores sheet (on a phone, behind the options sheet's Scores). */
async function scoreOf(p: Player, name: string): Promise<number> {
  await openPlayers(p.page);
  const raw = await p.page.locator(`[data-testid="player-item"][data-name="${name}"]`).getAttribute('data-score');
  await p.page.getByTestId('players-sheet-close').click();
  return Number(raw ?? 'NaN');
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Spy Game room, two phones join by code and the host sets the rounds', async () => {
  roomCode = await createParty(host.page, host.name, 'spygame');
  await expect(host.page.getByTestId('game-picker-meta')).toContainText('The Spy Game');
  // Three players are needed.
  await expect(host.page.getByTestId('start-game')).toBeDisabled();

  for (const p of [pia, quinn]) {
    await p.page.goto('/');
    await p.page.getByTestId('code-input-0').pressSequentially(roomCode, { delay: 20 });
    await expect(p.page.getByTestId('room-preview')).toContainText(/in the party · The Spy Game/);
    await p.page.getByTestId('home-join').click();
    await enterNameIfAsked(p.page, p.name);
    await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${roomCode}$`));
  }
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId('settings-rounds').fill('2');
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('2');
  // The rounds are the only setting: the round clock and the vote window are fixed.
  for (const id of ['roundMinutes', 'voteSeconds']) await expect(host.page.getByTestId(`settings-${id}`)).toHaveCount(0);
  await expect(pia.page.getByTestId('settings-panel')).toHaveCount(0);

  // How to play reads cleanly on a phone down to the narrowest and on the host's desktop ("1" / "to each agent" once split
  // at 360).
  for (const size of [PORTRAIT, ...NARROW]) {
    await pia.page.setViewportSize(size);
    await expectRulesReadCleanly(pia.page, 'The Spy Game', `The Spy Game at ${size.width}`);
  }
  await pia.page.setViewportSize(PORTRAIT);
  await expectRulesReadCleanly(host.page, 'The Spy Game', 'The Spy Game on the host’s desktop');

  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  await readyAll([pia.page, quinn.page]);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(p.page.getByTestId('spygame-role')).toBeVisible();
    await expect(p.page.getByTestId('round-indicator')).toContainText('Round 1');
    await expect(clock(p)).toBeVisible();
  }
  for (const p of players) await expect(p.page.getByTestId('round-indicator')).toContainText('1/2');
  // The top bar fits from the narrowest phone to a desktop, for a guest and for the host with End game, the game's name
  // whole on every one. A phone's one row (the logo, the name and round, the code, the clock and the options) is the fullest
  // line of any game: it has no players button (on the narrowest phones the logo makes way too).
  await gameBarFits(pia.page);
  await gameBarFits(host.page);
  // The options sheet (with its Scores row, and the host's End game) holds every row on a phone on its side too: nothing scrolls, nothing is cut.
  await menuSheetFits(pia.page);
  await menuSheetFits(host.page);
  await expect(pia.page.getByTestId('spygame-header').locator('.gbar__name')).toHaveText('The Spy Game');
  await expect(pia.page.getByTestId('round-indicator')).toBeVisible();
  await expect(clock(pia)).toBeVisible();
  // The page lists the players with their points; the options sheet opens the scores, its first tall row.
  await expect(pia.page.getByTestId('spygame-header').getByTestId('players-toggle')).toHaveCount(0);
  await pia.page.getByTestId('game-menu').click();
  const scores = pia.page.getByTestId('menu-players');
  await expect(scores).toContainText('Scores');
  await expect(scores).toContainText('3 players');
  expect((await boxOf(scores)).height).toBeGreaterThanOrEqual(MIN_TARGET);
  await scores.click();
  await expect(pia.page.getByTestId('menu-sheet')).toHaveCount(0);
  await expect(pia.page.getByTestId('players-sheet')).toContainText('Scores (3)');
  await expect(pia.page.getByTestId('players-sheet').getByTestId('player-item')).toHaveCount(3);
  await pia.page.getByTestId('players-sheet-close').click();
  await expect(pia.page.getByTestId('players-sheet')).toHaveCount(0);
});

test('exactly one spy; the agents share the location, the spy sees none and gets 24 tiles in three columns of eight on a phone', async () => {
  ({ spy, agents } = await castOf());
  expect(agents).toHaveLength(2);

  const ids = await Promise.all(agents.map((a) => a.page.getByTestId('spygame-location').getAttribute('data-location-id')));
  expect(ids[0]).toBeTruthy();
  expect(ids[1]).toBe(ids[0]);
  locationId = ids[0] ?? '';
  for (const a of agents) {
    await expect(a.page.getByTestId('spygame-role')).toContainText('You are not the spy');
    await expect(a.page.getByTestId('spygame-guesses-left')).toHaveAttribute('data-count', '2');
    await expect(a.page.getByTestId('candidate-tile')).toHaveCount(24);
    await expect(a.page.locator(`[data-testid="candidate-tile"][data-location-id="${locationId}"]`)).toHaveAttribute('data-state', 'real');
    await expect(a.page.getByTestId('accuse-row')).toHaveCount(3);
    await expect(accuseRow(a, a.name)).toBeDisabled();
  }

  await expect(spy.page.getByTestId('spygame-role')).toContainText('You are the spy');
  await expect(spy.page.getByTestId('spygame-location')).toHaveCount(0);
  await expect(spy.page.getByTestId('candidate-tile')).toHaveCount(0);
  const tiles = spy.page.getByTestId('guess-tile');
  await expect(tiles).toHaveCount(24);
  // The grid is a phone layout: assert it at phone size whoever the spy is.
  await atPhoneSize(spy, async () => {
    await expect(spy.page.locator('.spy--phone')).toBeVisible();
    const boxes = await Promise.all(Array.from({ length: 24 }, (_, i) => boxOf(tiles.nth(i))));
    const columns = new Map<number, number>();
    for (const box of boxes) {
      const x = Math.round(box.x);
      columns.set(x, (columns.get(x) ?? 0) + 1);
      expect(box.height, 'a guess tile is a 44px target').toBeGreaterThanOrEqual(MIN_TARGET);
      expect(box.width, 'a guess tile is a 44px target').toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect([...columns.values()]).toEqual([8, 8, 8]);
    await noHorizontalOverflow(spy);
  });
  // On a portrait phone all 24 places are in view as the screen opens, for an agent and for the spy.
  for (const size of [PORTRAIT, { width: 375, height: 667 }]) {
    await allPlacesInView(agents[0], 'candidate-tile', size, 40);
    await allPlacesInView(spy, 'guess-tile', size, MIN_TARGET);
  }
  // Every place's name reads whole from 320 to 1920 wide, upright and on its side: the grid takes the columns its card has
  // room for (a tablet's half-width column two, not four) and the agents' ticked place keeps its name clear of the tick.
  await everyNameWhole(agents[0], 'candidate-tile');
  await everyNameWhole(spy, 'guess-tile');
  // The spy's player list is read-only: no accuse buttons.
  await expect(spy.page.locator('button[data-testid="accuse-row"]')).toHaveCount(0);
  await expect(spy.page.getByTestId('accuse-row')).toHaveCount(3);

  for (const p of phones()) await noHorizontalOverflow(p);
});

test('a wrong guess (two taps) is announced on every screen and rules the tile out', async () => {
  const ids = await spy.page.getByTestId('guess-tile').evaluateAll((els) => els.map((el) => el.getAttribute('data-location-id') ?? ''));
  const wrong = ids.find((id) => id !== locationId);
  if (!wrong) throw new Error('no decoy');
  const tile = guessTile(spy, wrong);
  await tile.click();
  await expect(tile).toHaveAttribute('data-state', 'highlighted');
  await expect(tile).toContainText('Tap again to confirm');
  // Tapping another tile moves the highlight instead of guessing.
  const other = ids.find((id) => id !== locationId && id !== wrong) ?? '';
  await guessTile(spy, other).click();
  await expect(tile).toHaveAttribute('data-state', 'idle');
  await expect(guessTile(spy, other)).toHaveAttribute('data-state', 'highlighted');
  await tile.click();
  await tile.click();

  for (const p of players) {
    await expect(p.page.getByTestId('spygame-wrong-guess')).toContainText('1 guess left');
    await expect(p.page.getByTestId('spygame-guesses-left')).toHaveAttribute('data-count', '1');
  }
  await expect(tile).toHaveAttribute('data-state', 'ruledOut');
  await expect(tile).toBeDisabled();
  await expect(spy.page.getByTestId('spygame-location')).toHaveCount(0);
});

test('an accusation pauses the clock and opens the vote sheet; a tie fails and play resumes', async () => {
  const [accuser, other] = agents;
  const row = accuseRow(accuser, spy.name);
  await row.click();
  await expect(row).toHaveAttribute('data-state', 'highlighted');
  await expect(row).toContainText('Tap again to accuse');
  await row.click();

  await expect(other.page.getByTestId('vote-sheet')).toBeVisible();
  await expect(other.page.getByTestId('vote-sheet')).toContainText(`${accuser.name}`);
  await expect(other.page.getByTestId('vote-sheet')).toContainText(`${spy.name}`);
  for (const id of ['vote-yes', 'vote-no']) {
    const box = await boxOf(other.page.getByTestId(id));
    expect(box.height, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  // "Yes, spy" is ink on the restrained salmon danger fill (7.7:1), never white on it.
  await expect(other.page.getByTestId('vote-yes')).toHaveCSS('background-color', 'rgb(255, 155, 167)');
  await expect(other.page.getByTestId('vote-yes')).toHaveCSS('color', 'rgb(20, 21, 20)');
  // The accuser's auto-Yes is already on the board. Nothing says how many may still vote: that would name the spy.
  await expect(other.page.getByTestId('vote-tally')).toHaveAttribute('data-yes', '1');
  await expect(other.page.getByTestId('vote-tally')).toHaveAttribute('data-no', '0');
  await expect(other.page.getByTestId('vote-tally')).not.toHaveAttribute('data-pending', /.*/);
  await expect(other.page.getByTestId('vote-sheet')).not.toContainText('to go');
  // The spy (here the accused) has no say, and neither does the accuser beyond their fixed Yes.
  await expect(spy.page.getByTestId('vote-panel')).toHaveAttribute('data-role', 'accused');
  await expect(spy.page.getByTestId('vote-panel')).toContainText("You’ve been accused!");
  await expect(spy.page.getByTestId('vote-yes')).toHaveCount(0);
  await expect(spy.page.getByTestId('vote-sheet')).toHaveCount(0);
  await expect(spy.page.getByTestId('vote-panel-tally')).toHaveAttribute('data-yes', '1');
  await expect(accuser.page.getByTestId('vote-panel')).toHaveAttribute('data-role', 'accuser');
  await expect(accuser.page.getByTestId('vote-yes')).toHaveCount(0);
  for (const p of players) await expect(clock(p)).toHaveAttribute('data-paused', 'vote');

  // A No makes it 1-1: a tie fails, the clock resumes, the accuser's accusation is spent.
  await other.page.getByTestId('vote-no').click();
  // Nothing else on screen says the vote failed: everyone gets a toast, with no count that could name the spy.
  for (const p of players) await expect(p.page.getByTestId('toast').filter({ hasText: 'The vote failed. Play on.' })).toBeVisible();
  await expect(host.page.getByTestId('toast').filter({ hasText: 'The vote failed (' })).toHaveCount(0);
  for (const p of players) {
    await expect(p.page.getByTestId('vote-panel')).toHaveCount(0);
    await expect(clock(p)).not.toHaveAttribute('data-paused', /.+/);
    await expect(p.page.getByTestId('spygame-reveal')).toHaveCount(0);
  }
  await expect(other.page.getByTestId('vote-sheet')).toHaveCount(0);
  await expect(accuser.page.getByTestId('accuse-hint')).toContainText("You’ve used your accusation this round.");
  await expect(accuseRow(accuser, spy.name)).toBeDisabled();
  await expect(accuseRow(other, spy.name)).toBeEnabled();
});

test('the other agent accuses the spy, the vote passes and the reveal shows spyCaught with +3 / +1', async () => {
  const [first, accuser] = agents;
  await accuseRow(accuser, spy.name).click();
  await accuseRow(accuser, spy.name).click();
  await expect(first.page.getByTestId('vote-sheet')).toBeVisible();
  await expect(first.page.getByTestId('vote-tally')).toHaveAttribute('data-yes', '1');
  await first.page.getByTestId('vote-yes').click();

  for (const p of players) {
    const reveal = p.page.getByTestId('spygame-reveal');
    await expect(reveal).toBeVisible();
    await expect(reveal).toHaveAttribute('data-outcome', 'spyCaught');
    await expect(reveal.getByTestId('reveal-spy')).toContainText(spy.name);
    await expect(reveal.getByTestId('reveal-location')).toHaveAttribute('data-location-id', locationId);
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${accuser.name}"]`)).toHaveAttribute('data-points', '3');
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${first.name}"]`)).toHaveAttribute('data-points', '1');
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${spy.name}"]`)).toHaveCount(0);
    await expect(clock(p)).toHaveAttribute('data-paused', 'reveal');
  }
  await expect(host.page.getByTestId('spygame-next-round')).toBeVisible();
  // Ending the game is the top bar's (or the options sheet's), not the reveal's.
  await expect(host.page.getByTestId('spygame-end-game')).toHaveCount(0);
  for (const p of phones()) {
    await expect(p.page.getByTestId('reveal-countdown')).toContainText('Next round soon');
    await expect(p.page.getByTestId('spygame-next-round')).toHaveCount(0);
    await noHorizontalOverflow(p);
  }
  await expect(host.page.getByTestId('spygame-reveal')).toContainText(spy.name);
});

test('the host starts round two; the spy guesses right for +4; the results list three players', async () => {
  await host.page.getByTestId('spygame-next-round').click();
  for (const p of players) {
    await expect(p.page.locator('[data-testid="spygame-screen"][data-phase="playing"]')).toBeVisible();
    await expect(p.page.getByTestId('round-indicator')).toContainText('Round 2');
    await expect(p.page.getByTestId('spygame-wrong-guess')).toHaveCount(0);
  }
  // Round one's scores stand.
  expect(await scoreOf(host, agents[1].name)).toBe(3);
  expect(await scoreOf(host, agents[0].name)).toBe(1);
  expect(await scoreOf(host, spy.name)).toBe(0);

  const cast = await castOf();
  expect(cast.spy).not.toBe(spy); // the spy rotates
  const agent = cast.agents[0];
  const location = (await agent.page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
  expect(location).toBeTruthy();
  await expect(cast.spy.page.getByTestId('guess-tile')).toHaveCount(24);
  const tile = guessTile(cast.spy, location);
  await tile.click();
  await tile.click();

  for (const p of players) {
    const reveal = p.page.getByTestId('spygame-reveal');
    await expect(reveal).toHaveAttribute('data-outcome', 'spyGuessed');
    await expect(reveal.getByTestId('reveal-spy')).toContainText(cast.spy.name);
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${cast.spy.name}"]`)).toHaveAttribute('data-points', '4');
  }
  await expect(host.page.getByTestId('spygame-next-round')).toContainText('Show results');
  await host.page.getByTestId('spygame-next-round').click();

  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end.getByTestId('results-entry')).toHaveCount(3);
  }
  for (const p of players) await closeResults(p.page);
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
  await readyAll([pia.page, quinn.page]);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
