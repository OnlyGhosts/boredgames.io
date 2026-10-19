import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { GAME_LIST, gameById, type GameId } from '../shared/platform/games';
import { closeResults, createParty, endGameAsHost, expectConfirmReadsOnce, expectGameBar, expectResults, gameBarFits, joinByCode, readyAll } from './party';

/**
 * How a game ends and how a player leaves, in every game: the host's End game ends it for
 * everyone at once and everyone lands in the lobby with the results over it; Leave room takes out
 * only the player who leaves while the game goes on; a leave that leaves too few players ends it,
 * the others getting the results; and The Spy Game's away spy is shown on the waiting card the
 * host can act on. Every game's top bar says what is being played and keeps the room's code, and
 * fits from the narrowest phone to a desktop. Three players: the host on a desktop, Pia on a
 * phone, Quinn on a desktop.
 * Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let pia: Player;
let quinn: Player;
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

/** The host switches the party to `gameId`, everyone readies up and the host starts it. */
async function startGame(gameId: GameId, everyone: Player[]): Promise<void> {
  await host.page.getByTestId('game-picker').locator(`[data-testid="game-tile"][data-game="${gameId}"]`).click();
  for (const p of everyone) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', gameId);
  await readyAll(everyone.filter((p) => p !== host).map((p) => p.page));
  await host.page.getByTestId('start-game').click();
  for (const p of everyone) await expect(p.page.getByTestId('room-code')).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true });
  quinn = await newPlayer(browser, 'Quinn');
  code = await createParty(host.page, host.name);
  for (const p of [pia, quinn]) await joinByCode(p.page, p.name, code);
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

const LIVE: GameId[] = GAME_LIST.filter((g) => g.status === 'live').map((g) => g.id);

for (const [index, gameId] of LIVE.entries()) {
  test(`the host ends ${gameId} for everyone at once: everyone is back in the lobby with the results, closing them leaves the lobby`, async () => {
    // Every other game the host ends it from a phone's options sheet instead of the desktop top bar.
    const onPhone = index % 2 === 1;
    if (onPhone) await host.page.setViewportSize(PORTRAIT);
    await startGame(gameId, players);
    // Everyone's bar says what is being played and keeps the room's code: the host and the guests, on a desktop and on a phone.
    for (const p of players) await expectGameBar(p.page, gameById(gameId).name, code);
    // The guests have no End game anywhere; a desktop guest's bar has Leave.
    await expect(quinn.page.getByTestId('end-game')).toHaveCount(0);
    await expect(quinn.page.getByTestId('leave-room')).toBeVisible();
    // A phone's logo is the two phones alone, no control: the options button holds the settings and the ways out.
    await expect(pia.page.getByTestId('game-brand').locator('.wordmark--icon')).toBeVisible();
    await expect(pia.page.getByTestId('game-brand').locator('button, a')).toHaveCount(0);
    if (index === 0) {
      // The bar's ways out are 44px targets. Leave opens the leave confirm, and only the button pressed reads as open.
      for (const [page, id] of [[host.page, 'end-game'], [quinn.page, 'leave-room']] as const) {
        expect((await page.getByTestId(id).boundingBox())?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(44);
      }
      await quinn.page.getByTestId('leave-room').click();
      await expect(quinn.page.getByTestId('game-leave-confirm')).toContainText('Leave the room?');
      // It says so once: the question heads it, no title row over it, and the button is Leave.
      await expectConfirmReadsOnce(quinn.page, 'Leave the room?', quinn.page.getByTestId('game-leave-yes'), 'Leave');
      await expect(quinn.page.getByTestId('leave-room')).toHaveAttribute('aria-expanded', 'true');
      await expect(quinn.page.getByTestId('brand-link')).toHaveAttribute('aria-expanded', 'false');
      await quinn.page.getByTestId('game-leave-no').click();
      await expect(quinn.page.getByTestId('game-leave-confirm')).toHaveCount(0);
      await expect(quinn.page.getByTestId('leave-room')).toHaveAttribute('aria-expanded', 'false');
      // The logo never drops a player out of a game: it asks first, with the same confirm; Stay keeps them playing.
      await quinn.page.getByTestId('game-brand').getByTestId('brand-link').click();
      await expect(quinn.page.getByTestId('game-leave-confirm')).toContainText('Leave the room?');
      await expect(quinn.page.getByTestId('brand-link')).toHaveAttribute('aria-expanded', 'true');
      await expect(quinn.page.getByTestId('leave-room')).toHaveAttribute('aria-expanded', 'false');
      await quinn.page.getByTestId('game-leave-no').click();
      await expect(quinn.page.getByTestId('leave-sheet')).toHaveCount(0);
      await expect(quinn.page).toHaveURL(new RegExp(`/${code}$`));
      await expectGameBar(quinn.page, gameById(gameId).name, code);
      // The logo's gear "o" opens the site's settings in a game as in the waiting room: the theme and the sound, nothing else.
      const gear = quinn.page.getByTestId('game-brand').getByTestId('settings-menu');
      expect((await gear.boundingBox())?.height ?? 0, 'the gear is a 44px target').toBeGreaterThanOrEqual(44);
      await gear.click();
      const popover = quinn.page.getByTestId('settings-popover');
      await expect(popover).toBeVisible();
      await expect(popover.getByTestId('theme-dark')).toBeVisible();
      await expect(popover.getByTestId('sound-toggle')).toBeVisible();
      await expect(popover.locator('button')).toHaveCount(3);
      await quinn.page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(gear).toBeFocused();
    }
    // The host's bar (End game in it, the fullest) fits at every width; The Spy Game's long name may give way on a phone's one row.
    await gameBarFits(host.page, { nameMayCutBelow: gameId === 'spygame' ? 768 : 0 });
    await pia.page.getByTestId('game-menu').click();
    await expect(pia.page.getByTestId('leave-room')).toBeVisible();
    await expect(pia.page.getByTestId('end-game')).toHaveCount(0);
    await pia.page.getByTestId('menu-sheet-close').click();

    await endGameAsHost(host.page);
    for (const p of players) {
      await expectResults(p.page);
      await expect(p.page.getByTestId('results-reason')).toHaveText('The host ended the game.');
      await expect(p.page.getByTestId('results-entry')).toHaveCount(3);
    }
    for (const p of players) await closeResults(p.page);
    for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    if (onPhone) await host.page.setViewportSize(DESKTOP);
  });
}

test('a player leaves mid-game from the options sheet: only they go, to the front door, and the game goes on for the others', async () => {
  // Blackjack seats any number from one: two left can carry on.
  await startGame('blackjack', players);
  await pia.page.getByTestId('game-menu').click();
  await pia.page.getByTestId('leave-room').click();
  await expect(pia.page.getByTestId('game-leave-confirm')).toContainText('The game goes on without you.');
  await pia.page.getByTestId('game-leave-yes').click();
  await expect(pia.page.getByTestId('home-create')).toBeVisible();
  await expect(pia.page).toHaveURL(/\/$/);

  for (const p of [host, quinn]) {
    await expect(p.page.getByTestId('blackjack-screen')).toBeVisible();
    await expect(p.page.getByTestId('overlay-game-end')).toHaveCount(0);
    await expect(p.page.getByTestId('place-bet')).toBeVisible();
  }
  // The game goes on: Quinn's bet is down and the table waits for the host's.
  await quinn.page.getByTestId('place-bet').click();
  await expect(quinn.page.getByTestId('place-bet')).toHaveAttribute('data-placed', 'true');
  await expect(host.page.getByTestId('place-bet')).toBeEnabled();
  // Between hands End game ends it at once, Quinn's stake back.
  await endGameAsHost(host.page);
  for (const p of [host, quinn]) await closeResults(p.page);
  for (const p of [host, quinn]) await expect(p.page.getByTestId('player-item')).toHaveCount(2);

  // Pia comes back for the rest.
  await joinByCode(pia.page, pia.name, code);
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
});

test('a leave that leaves too few players ends the game, and the others get the results saying why', async () => {
  // The Spy Game needs three.
  await startGame('spygame', players);
  await quinn.page.getByTestId('leave-room').click();
  await expect(quinn.page.getByTestId('game-leave-confirm')).toContainText('Too few would be left, so the game ends for everyone.');
  await quinn.page.getByTestId('game-leave-yes').click();
  await expect(quinn.page.getByTestId('home-create')).toBeVisible();
  for (const p of [host, pia]) {
    await expectResults(p.page);
    await expect(p.page.getByTestId('results-reason')).toHaveText('Too few players were left.');
    await expect(p.page.getByTestId('results-headline')).toHaveText('Game over');
    await closeResults(p.page);
    await expect(p.page.getByTestId('player-item')).toHaveCount(2);
  }
  await joinByCode(quinn.page, quinn.name, code);
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
});

test('the spy drops: the host gets the waiting card naming the spy with Remove, and removing them ends the round', async ({ browser }) => {
  test.setTimeout(90_000);
  // A fourth player, so the game can go on without the spy.
  const rae = await newPlayer(browser, 'Rae');
  await joinByCode(rae.page, rae.name, code);
  await startGame('spygame', players);
  for (const p of players) await expect(p.page.getByTestId('spygame-role')).toBeVisible();
  const roles = await Promise.all(players.map(async (p) => (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? ''));
  const spy = players[roles.indexOf('spy')];
  const others = players.filter((p) => p !== spy);
  // The spy's phone goes dark: its socket is gone.
  await spy.context.close();
  players.splice(players.indexOf(spy), 1);

  // Everyone sees the card; whoever is host now (the host, or a stand-in when the host is the spy) can remove them.
  for (const p of others) {
    await expect(p.page.getByTestId('overlay-waiting')).toBeVisible({ timeout: 20_000 });
    await expect(p.page.getByTestId('waiting-title')).toContainText(spy.name);
    await expect(p.page.getByTestId('waiting-hint')).toContainText('If they are not back in');
    // The count is for holds about numbers: here enough are connected, so it is not shown.
    await expect(p.page.getByTestId('waiting-count')).toHaveCount(0);
  }
  let boss: Player | null = null;
  await expect
    .poll(async () => {
      for (const p of others) if (await p.page.getByTestId('waiting-remove').isVisible()) boss = p;
      return boss?.name ?? null;
    })
    .not.toBeNull();
  if (!boss) throw new Error('nobody can remove the spy');
  const remover: Player = boss;
  await expect(remover.page.getByTestId('waiting-remove')).toContainText(`Remove ${spy.name}`);
  await remover.page.getByTestId('waiting-remove').click();
  for (const p of others) {
    await expect(p.page.getByTestId('overlay-waiting')).toHaveCount(0);
    await expect(p.page.getByTestId('spygame-reveal')).toHaveAttribute('data-outcome', 'spyLeft');
  }
  await endGameAsHost(remover.page);
  for (const p of others) await closeResults(p.page);
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
