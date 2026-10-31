import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SqliteAnalyticsStore } from '../server/platform/admin/sqliteStore';
import { shiftDay, ukDay, type Summary } from '../shared/platform/admin';
import { proxyAs } from './netProxy';
import { endGameAsHost, enterNameIfAsked, readRoomCode, readyAll } from './party';

/**
 * The admin dashboard on its own host (admin.localhost here; Chromium sends every *.localhost to
 * the machine itself). The spec runs its own production server on E2E_ADMIN_PORT with the admin
 * set up, headless Chrome counted and the analytics in a SQLite file, so it can restart it and
 * find the counts still there.
 */
const PORT = Number(process.env.E2E_ADMIN_PORT ?? 5366);
const SITE = `http://localhost:${PORT}`;
const ADMIN = `http://admin.localhost:${PORT}`;
const PASSWORD = 'e2e-secret';
const PIXEL_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

class Server {
  private child: ChildProcess | null = null;
  output = '';

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async start(): Promise<void> {
    this.output = '';
    const child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, ...this.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    await expect
      .poll(async () => {
        if (child.exitCode !== null) throw new Error(`the server exited:\n${this.output}`);
        return fetch(`${SITE}/api/health`).then((r) => r.ok, () => false);
      }, { message: `the server on ${PORT}`, timeout: 20_000 })
      .toBe(true);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await gone;
  }
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'bg-admin-e2e-'));
const server = new Server({
  PORT: String(PORT),
  ADMIN_HOST: 'admin.localhost',
  ADMIN_PASSWORD: PASSWORD,
  ADMIN_SESSION_KEY: 'e2e-key',
  ANALYTICS_COUNT_HEADLESS: '1',
  ANALYTICS_DB: path.join(dataDir, 'analytics.db'),
});

/** Yesterday in London. The browsers can only make today's numbers, so yesterday's are written into the file before the server opens it. */
const YESTERDAY = shiftDay(ukDay(Date.now()), -1);

async function seedYesterday(file: string): Promise<void> {
  const store = new SqliteAnalyticsStore(file);
  // Noon UTC is noon or 1pm in London: always on that UK day.
  const noon = Date.parse(`${YESTERDAY}T12:00:00Z`);
  for (const [i, visitor] of ['y1', 'y2', 'y3'].entries()) store.recordVisit({ ts: noon + i * 60_000, visitor, path: '/', source: 'direct', subreddit: null, game: null, device: 'phone' });
  // A room opened on Scribble, the default, and its host switched to Blackjack and played it.
  store.recordEvent({ ts: noon, kind: 'room_created', gameId: 'scribble' });
  store.recordEvent({ ts: noon, kind: 'player_joined', gameId: 'scribble' });
  store.recordEvent({ ts: noon, kind: 'player_joined', gameId: 'scribble' });
  store.recordEvent({ ts: noon + 60_000, kind: 'game_started', gameId: 'blackjack', players: 2 });
  store.recordEvent({ ts: noon + 600_000, kind: 'game_ended', gameId: 'blackjack', finished: true });
  await store.close();
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  await seedYesterday(path.join(dataDir, 'analytics.db'));
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const closers: Array<() => Promise<void>> = [];
test.afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function context(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(options);
  closers.push(() => ctx.close());
  return ctx;
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/`);
  await page.getByTestId('admin-password').fill(PASSWORD);
  await page.getByTestId('admin-sign-in').click();
  await expect(page.getByTestId('analytics')).toBeVisible();
}

/** Today's summary, read by the signed-in admin page. */
function today(admin: Page): Promise<Summary> {
  return admin.evaluate(() => fetch('/api/admin/summary?range=today').then((r) => r.json() as Promise<Summary>));
}

test('the admin host asks for the password, refuses a wrong one, and keeps its cookie to itself', async ({ browser }) => {
  const admin = await (await context(browser)).newPage();
  await admin.goto(`${ADMIN}/`);
  await expect(admin.getByTestId('admin-login')).toBeVisible();
  expect(await admin.evaluate(() => fetch('/api/admin/summary').then((r) => r.status))).toBe(401);

  await admin.getByTestId('admin-password').fill('not it');
  await admin.getByTestId('admin-sign-in').click();
  await expect(admin.getByTestId('admin-login-error')).toHaveText('Wrong password');

  await admin.getByTestId('admin-password').fill(PASSWORD);
  await admin.getByTestId('admin-sign-in').click();
  await expect(admin.getByTestId('analytics')).toBeVisible();
  await expect(admin.getByTestId('tile-visitors')).toBeVisible();

  const cookies = await admin.context().cookies([ADMIN, SITE]);
  expect(cookies.map((c) => [c.name, c.domain, c.httpOnly, c.secure, c.sameSite])).toEqual([['bg_admin', 'admin.localhost', true, true, 'Strict']]);
  // The site itself has no admin pages.
  const site = await admin.context().newPage();
  expect((await site.goto(`${SITE}/admin`))?.status()).toBe(404);

  await admin.getByTestId('admin-sign-out').click();
  await expect(admin.getByTestId('admin-login')).toBeVisible();
  expect(await admin.context().cookies(ADMIN)).toEqual([]);
});

test('two phones and a played room show on Analytics and Live rooms', async ({ browser }) => {
  const admin = await (await context(browser)).newPage();
  await signIn(admin);
  await admin.getByTestId('tab-rooms').click();
  await expect(admin.getByTestId('live-rooms')).toBeVisible();

  // Both phones on one Wi-Fi (a proxy saying which address they come from, as Fly's does).
  const wifi = await proxyAs('203.0.113.77', SITE);
  closers.push(wifi.close);
  const host = await (await context(browser, { ...PHONE, baseURL: wifi.origin })).newPage();
  const guest = await (await context(browser, { ...PHONE, baseURL: wifi.origin, userAgent: PIXEL_UA })).newPage();

  await host.goto('/?game=scribble&ref=e2e');
  await host.getByTestId('home-create').click();
  await enterNameIfAsked(host, 'Hana');
  const code = await readRoomCode(host);

  await guest.goto('/?game=scribble&ref=e2e');
  const card = guest.locator(`[data-testid="nearby-room"][data-code="${code}"]`);
  await card.getByTestId('nearby-join').click();
  await enterNameIfAsked(guest, 'Pia');
  await expect(guest.getByTestId('room-code')).toHaveText(code);

  // The Live rooms page polls every 5 seconds; the room is a card with its code on tiles.
  const room = admin.locator(`[data-testid="room-card"][data-code="${code}"]`);
  await expect(room).toBeVisible({ timeout: 6000 });
  await expect(room.getByTestId('room-card-code')).toHaveText(code);
  await expect(room).toContainText('Scribble');
  await expect(room.getByTestId('room-phase')).toHaveText('In the lobby');

  await readyAll([guest]);
  await host.getByTestId('start-game').click();
  await expect(host.getByTestId('lobby')).toHaveCount(0);
  await expect(room.getByTestId('room-phase')).toHaveText('Playing', { timeout: 6000 });
  await endGameAsHost(host);
  await expect(host.getByTestId('lobby')).toBeVisible();

  await expect.poll(async () => (await today(admin)).totals.finished, { timeout: 10_000 }).toBe(1);
  await admin.getByTestId('tab-analytics').click();
  await admin.reload();
  await expect(admin.getByTestId('analytics')).toBeVisible();
  const visitors = Number(await admin.getByTestId('tile-visitors').locator('.tile__value').textContent());
  expect(visitors).toBeGreaterThanOrEqual(2);
  await expect(admin.getByTestId('sources')).toContainText('?ref=e2e');
  await expect(admin.getByTestId('deep-links')).toContainText('Scribble');
  await expect(admin.getByTestId('joins-nearby')).toHaveText('1');
  await expect(admin.getByTestId('tile-rooms').locator('.tile__value')).toHaveText('1');
  await expect(admin.getByTestId('tile-started').locator('.tile__value')).toHaveText('1');
  await expect(admin.locator('[data-testid="game-row"][data-game="scribble"]')).toContainText('Scribble');
});

test('Analytics steps back a day to that day’s numbers, and a bar in 7 days opens its day', async ({ browser }) => {
  const admin = await (await context(browser)).newPage();
  await signIn(admin);
  const label = admin.getByTestId('day-label');
  const visitors = admin.getByTestId('tile-visitors').locator('.tile__value');
  await expect(admin.getByTestId('range-day')).toHaveAttribute('aria-pressed', 'true');
  await expect(label).toHaveText('Today');
  await expect(admin.getByTestId('day-next')).toBeDisabled();
  const todays = String((await today(admin)).totals.visitors);
  await expect(visitors).toHaveText(todays);

  await admin.getByTestId('day-prev').click();
  await expect(label).toHaveText('Yesterday');
  await expect(visitors).toHaveText('3');
  await expect(admin.getByTestId('tile-rooms').locator('.tile__value')).toHaveText('1');
  await expect(admin.getByTestId('tile-started').locator('.tile__value')).toHaveText('1');
  // The game the room played, not the one it opened on.
  await expect(admin.locator('[data-testid="game-row"]')).toHaveCount(1);
  await expect(admin.locator('[data-testid="game-row"][data-game="blackjack"]')).toBeVisible();
  await expect(admin.locator('[data-testid="bar"]')).toHaveCount(0);
  expect(new URL(admin.url()).hash).toBe(`#analytics/${YESTERDAY}`);

  // A reload keeps the day.
  await admin.reload();
  await expect(label).toHaveText('Yesterday');
  await expect(visitors).toHaveText('3');

  // The day before has nothing yet: zeros, not an error.
  await admin.getByTestId('day-prev').click();
  await expect(label).toHaveText(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})?$/);
  await expect(visitors).toHaveText('0');

  await admin.getByTestId('day-next').click();
  await expect(label).toHaveText('Yesterday');
  await admin.getByTestId('day-next').click();
  await expect(label).toHaveText('Today');
  await expect(visitors).toHaveText(todays);
  await expect(admin.getByTestId('day-next')).toBeDisabled();

  // In 7 days, yesterday's bar is a button that opens yesterday in Day mode.
  await admin.getByTestId('range-7d').click();
  await expect(label).toHaveCount(0);
  const bar = admin.locator(`[data-testid="bar"][data-day="${YESTERDAY}"]`);
  await expect(bar).toHaveAttribute('data-value', '3');
  await expect(bar).toHaveAttribute('aria-label', /^Show [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
  await bar.click();
  await expect(admin.getByTestId('range-day')).toHaveAttribute('aria-pressed', 'true');
  await expect(label).toHaveText('Yesterday');
  await expect(visitors).toHaveText('3');
  expect(new URL(admin.url()).hash).toBe(`#analytics/${YESTERDAY}`);
});

test('a saved notice shows on the home page, and switching it off takes it away', async ({ browser }) => {
  const admin = await (await context(browser)).newPage();
  await signIn(admin);
  await admin.getByTestId('tab-notice').click();
  await admin.getByTestId('notice-text').fill('Quick restart at 9pm');
  await expect(admin.getByTestId('notice-preview')).toHaveText('Quick restart at 9pm');
  await expect(admin.getByTestId('notice-on')).toHaveAttribute('aria-checked', 'true');
  await admin.getByTestId('notice-save').click();
  await expect(admin.getByTestId('notice-saved')).toBeVisible();

  const home = await (await context(browser, PHONE)).newPage();
  const shown = home.getByTestId('site-notice');
  await expect(async () => {
    await home.goto(`${SITE}/`);
    await expect(shown).toHaveText('Quick restart at 9pm', { timeout: 3000 });
  }).toPass({ timeout: 35_000 });
  // Above the code boxes.
  const banner = await shown.boundingBox();
  const boxes = await home.getByTestId('join-panel').boundingBox();
  expect(banner!.y + banner!.height).toBeLessThanOrEqual(boxes!.y);

  await admin.getByTestId('notice-on').click();
  await expect(admin.getByTestId('notice-on')).toHaveAttribute('aria-checked', 'false');
  await admin.getByTestId('notice-save').click();
  await expect(admin.getByTestId('notice-saved')).toBeVisible();
  await expect(async () => {
    const asked = home.waitForResponse((r) => r.url().endsWith('/api/notice'));
    await home.goto(`${SITE}/`);
    await asked;
    await expect(home.getByTestId('home-join')).toBeVisible();
    await expect(shown).toHaveCount(0);
  }).toPass({ timeout: 35_000 });
});

test('the counts survive a server restart', async ({ browser }) => {
  const admin = await (await context(browser)).newPage();
  await signIn(admin);
  const before = await today(admin);
  expect(before.totals.visitors).toBeGreaterThanOrEqual(2);

  await server.stop();
  await server.start();

  // Same password and session key: the cookie still signs in.
  await admin.reload();
  await expect(admin.getByTestId('analytics')).toBeVisible();
  const after = await today(admin);
  expect(after.totals).toEqual(before.totals);
  expect(after.sources).toEqual(before.sources);
  await expect(admin.getByTestId('tile-visitors').locator('.tile__value')).toHaveText(String(before.totals.visitors));
});
