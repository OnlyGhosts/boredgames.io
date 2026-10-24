import { expect, test, type Browser, type Page } from '@playwright/test';
import { proxyAs } from './netProxy';
import { createParty, enterNameIfAsked, leaveLobby, readRoomCode, readyAll } from './party';

/**
 * "On your Wi-Fi": a room shows on the front door of phones on the network it was made on. The
 * suite runs on one machine, whose own address lists nothing, so each network is a little proxy
 * in front of the server that says which public address its phones come from, as Fly's does.
 */
const closers: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  // Pages first, then the proxies they came through.
  for (const close of closers.splice(0).reverse()) await close();
});

let net = 0;
/** A network: the origin its phones open the site on. */
async function network(target: string): Promise<string> {
  const proxy = await proxyAs(`203.0.113.${(Date.now() + ++net) % 250}`, target);
  closers.push(proxy.close);
  return proxy.origin;
}

async function phone(browser: Browser, origin: string, name?: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 428, height: 753 } });
  closers.push(() => context.close());
  if (name) await context.addInitScript((n) => {
      if (location.protocol.startsWith('http')) window.localStorage.setItem('boredgames.name', n);
    }, name);
  return context.newPage();
}

const card = (page: Page, code: string) => page.locator(`[data-testid="nearby-room"][data-code="${code}"]`);

test('phones on the same network see the room, join with one tap, watch a game on, and it goes once everyone leaves', async ({ browser, baseURL }) => {
  const here = await network(baseURL ?? '');
  const host = await phone(browser, here);
  const code = await createParty(host, 'Hera');

  const guest = await phone(browser, here, 'Gus');
  await guest.goto('/');
  await expect(guest.getByTestId('nearby')).toContainText('On your Wi-Fi');
  await expect(card(guest, code)).toContainText('Hera’s room');
  await expect(card(guest, code).getByTestId('nearby-meta')).toHaveText(/ · 1 player · just now$/);
  // The meta stays on one line beside the avatar and the button.
  const meta = await card(guest, code).getByTestId('nearby-meta').boundingBox();
  expect(meta?.height ?? 99).toBeLessThan(24);

  // A saved name: one tap and they are in.
  await card(guest, code).getByTestId('nearby-join').click();
  await expect(guest.getByTestId('room-code')).toHaveText(code);

  // No saved name: the name step first, as when typing the code.
  const newcomer = await phone(browser, here);
  await newcomer.goto('/');
  await expect(card(newcomer, code)).toContainText('2 players');
  await card(newcomer, code).getByTestId('nearby-join').click();
  await expect(newcomer.getByTestId('name-step')).toBeVisible();
  await enterNameIfAsked(newcomer, 'Nia');
  expect(await readRoomCode(newcomer)).toBe(code);

  // Another network sees nothing at all.
  const elsewhere = await phone(browser, await network(baseURL ?? ''));
  await elsewhere.goto('/');
  await expect(elsewhere.getByTestId('home-join')).toBeVisible();
  await expect(elsewhere.getByTestId('nearby')).toHaveCount(0);

  // A game on: still listed, playing now, and Join lets a latecomer watch.
  await readyAll([guest, newcomer]);
  await host.getByTestId('start-game').click();
  await expect(host.getByTestId('lobby')).toHaveCount(0);
  const later = await phone(browser, here, 'Lou');
  await later.goto('/');
  await expect(card(later, code).getByTestId('nearby-meta')).toHaveText(/ · 3 players · playing now$/);
  await card(later, code).getByTestId('nearby-join').click();
  await expect(later).toHaveURL(new RegExp(`/${code}$`));
  await expect(later.getByTestId('home-join')).toHaveCount(0);

  // Everyone goes: the room is off the list straight away.
  for (const p of [host, guest, newcomer, later]) await p.context().close();
  const last = await phone(browser, here);
  await last.goto('/');
  await last.waitForResponse((r) => r.url().endsWith('/api/nearby'));
  await expect(last.getByTestId('nearby')).toHaveCount(0);
});

test('a host who makes a new room alone takes the old one off the list', async ({ browser, baseURL }) => {
  const here = await network(baseURL ?? '');
  const host = await phone(browser, here);
  const first = await createParty(host, 'Hera');
  const viewer = await phone(browser, here);
  await viewer.goto('/');
  await expect(card(viewer, first)).toBeVisible();
  await leaveLobby(host);
  const second = await createParty(host, 'Hera');
  await expect(card(viewer, second)).toBeVisible();
  await expect(card(viewer, first)).toHaveCount(0);
});

test('a room made on one server instance is listed by the other (two processes sharing Redis)', async ({ browser }) => {
  const address = `198.51.100.${(Date.now() % 250) + 1}`;
  const a = await proxyAs(address, 'http://localhost:4181');
  const b = await proxyAs(address, 'http://localhost:4182');
  closers.push(a.close, b.close);
  const host = await phone(browser, a.origin);
  const code = await createParty(host, 'Ada');
  const guest = await phone(browser, b.origin, 'Bo');
  await guest.goto('/');
  await card(guest, code).getByTestId('nearby-join').click();
  await expect(guest.getByTestId('room-code')).toHaveText(code);
  await expect(host.locator('[data-testid="player-item"][data-name="Bo"]')).toBeVisible();
});
