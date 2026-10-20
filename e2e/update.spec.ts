import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { createParty, endGameAsHost, joinByCode, readyAll } from './party';

/**
 * A tab picks up a new version by itself (client/src/platform/lib/useAutoUpdate.ts). The build's
 * own /version.json is served by the server and rewritten on its way to the page to name another
 * build: the page reloads at once on the home screen (once the player leaves the field they are
 * typing in), waits for a running game to end, and reloads for a given version once only.
 */
test.describe.configure({ mode: 'serial' });

const NEXT = 'next-build-for-e2e';
const VERSION_RE = /\/version\.json(\?|$)/;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  loads: number;
  errors: string[];
}

const players: Player[] = [];

async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const player: Player = { name, context, page, loads: 0, errors: [] };
  page.on('load', () => player.loads++);
  page.on('pageerror', (err) => player.errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') player.errors.push(`${name}: ${msg.text()}`);
  });
  players.push(player);
  return player;
}

/** The served version.json, from the build on disk, now naming NEXT. */
async function serveNextVersion(page: Page): Promise<void> {
  await page.route(VERSION_RE, async (route: Route) => {
    const response = await route.fetch();
    expect(response.headers()['cache-control']).toBe('no-store');
    const served = (await response.json()) as { id: string };
    expect(served.id.length).toBeGreaterThan(0);
    expect(served.id).not.toBe(NEXT);
    await route.fulfill({ response, json: { id: NEXT } });
  });
}

/** What the tab does when it next checks: brought back into view (as after another tab). */
async function checkNow(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/** Checks until the tab decides `decision`; the check is harmless to repeat, so it also waits out the app starting. */
async function expectDecision(page: Page, decision: string): Promise<void> {
  await expect
    .poll(async () => {
      await checkNow(page);
      return page.locator('html').getAttribute('data-update');
    })
    .toBe(decision);
}

const reloadedFor = (page: Page) => page.evaluate(() => sessionStorage.getItem('boredgames.reloadedFor'));

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the build serves its version.json uncached and the page it runs is that version', async ({ browser, request }) => {
  const version = await request.get('/version.json');
  expect(version.ok()).toBe(true);
  expect(version.headers()['cache-control']).toBe('no-store');
  expect(((await version.json()) as { id: string }).id).toMatch(/\S/);
  for (const path of ['/', '/scribble/XK4P']) expect((await request.get(path)).headers()['cache-control'], path).toBe('no-cache');

  const p = await newPlayer(browser, 'Ada');
  await p.page.goto('/');
  await expect(p.page.getByTestId('home-create')).toBeVisible();
  await expectDecision(p.page, 'none');
  expect(p.loads).toBe(1);
});

test('on the home screen a new version reloads the page, once the player leaves the field', async () => {
  const p = players[0];
  await serveNextVersion(p.page);
  await p.page.getByTestId('code-input-0').click();
  await expectDecision(p.page, 'wait');
  expect(p.loads).toBe(1);

  await p.page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect.poll(() => p.loads).toBe(2);
  await expect(p.page.getByTestId('home-create')).toBeVisible();
  expect(await reloadedFor(p.page)).toBe(NEXT);
});

test('it reloads once only: still the same new version after the reload, the page stays', async () => {
  const p = players[0];
  await expectDecision(p.page, 'leave');
  await expectDecision(p.page, 'leave');
  expect(p.loads).toBe(2);
});

test('in a running game the page waits for the game to end, then reloads once', async ({ browser }) => {
  const host = await newPlayer(browser, 'Dana');
  const guest = await newPlayer(browser, 'Eli');
  const code = await createParty(host.page, host.name);
  await joinByCode(guest.page, guest.name, code);
  await readyAll([guest.page]);
  await host.page.getByTestId('start-game').click();
  await expect(host.page.getByTestId('start-game')).toHaveCount(0);
  await expect(host.page.getByTestId('end-game')).toBeVisible();
  await expectDecision(host.page, 'none');

  await serveNextVersion(host.page);
  // Out of any field (a guesser's box may hold focus): the game alone holds the reload back.
  await host.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expectDecision(host.page, 'wait');
  await expectDecision(host.page, 'wait');
  expect(host.loads).toBe(1);
  await expect(host.page.getByTestId('end-game')).toBeVisible();

  await endGameAsHost(host.page);
  await expect.poll(() => host.loads).toBe(2);
  // Back in the same room's lobby after the reload, with the guest still there.
  await expect(host.page.getByTestId('room-code')).toHaveText(code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  expect(await reloadedFor(host.page)).toBe(NEXT);

  await expectDecision(host.page, 'leave');
  expect(host.loads).toBe(2);
  expect(guest.loads).toBe(1);
});

test('no page errors were raised in any browser', () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
