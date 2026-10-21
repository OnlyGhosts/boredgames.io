import { expect, test, type Page } from '@playwright/test';
import { HOME_TAB_TITLE, isOwnPage404 } from './party';

/**
 * What search engines and link previews get, against the built server: the front door as real
 * HTML before any script runs, room links kept out of the index, a true 404 for unknown paths,
 * and the prerendered front door hydrating cleanly for a returning player.
 */

const HOME_TITLE_TAG = `<title>${HOME_TAB_TITLE}</title>`;

/** Every console error and uncaught exception from here on (a hydration mismatch reports as one); a page's own 404 status is none. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !isOwnPage404(m)) errors.push(`${m.text()} @ ${m.location().url}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('the front door is real HTML before any script runs', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain(HOME_TITLE_TAG);
  expect(html).toContain('<link rel="canonical" href="https://boredgames.io/"');
  expect(html).toContain('<meta name="robots" content="index, follow"');
  expect(html).toContain('<meta property="og:title" content="boredgames.io: party games for phones in the same room"');
  expect(html).toContain('<h1 class="sr-only">boredgames.io</h1>');
  expect(html).toContain('data-testid="home-create"');
  expect(html).toContain('data-testid="home-join"');
  expect(html).toContain('data-prerendered="/"');
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)![1]) as { '@type': string }[];
  expect(ld.map((o) => o['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication']);
  // The canonical host indexes the front door; only the Fly copy answers noindex (unit-tested).
  expect((await request.get('/')).headers()['x-robots-tag']).toBeUndefined();
  expect(await (await request.get('/robots.txt')).text()).toContain('Allow: /');
  expect(await (await request.get('/sitemap.xml')).text()).toContain('<loc>https://boredgames.io/</loc>');
});

test('a share link shows the front door card and stays out of the index', async ({ request }) => {
  for (const path of ['/scribble/ZZZZ', '/ZZZZ']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
    const html = await res.text();
    expect(html, path).toContain(HOME_TITLE_TAG);
    expect(html, path).toContain('data-testid="home-join"');
  }
});

test('an unknown path is a real 404 and still lands on the front door', async ({ page, request }) => {
  const res = await request.get('/nope/path');
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('<meta name="robots" content="noindex"');
  const errors = collectErrors(page);
  await page.goto('/nope/path');
  await expect(page.getByTestId('toast')).toContainText(/does not exist/i);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-create')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`${size.width}x${size.height}: a returning player hydrates the front door with no errors`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('boredgames.name', 'Hosty'));
    const errors = collectErrors(page);
    await page.goto('/?room=MRAN');
    await expect(page).toHaveTitle(/MRAN|𝗠𝗥𝗔𝗡/);
    await expect(page.getByTestId('home-join')).toBeVisible();
    // The code from the query is in the boxes from the first paint on.
    await expect(page.getByTestId('code-input-0')).toHaveValue('M');
    await expect(page.getByTestId('code-input-3')).toHaveValue('N');
    // The saved name came in after mount: Create skips the name step and seats Hosty in a new room.
    await page.getByTestId('home-create').click();
    await expect(page.getByTestId('room-code')).toBeVisible();
    await expect(page.getByTestId('name-step')).toHaveCount(0);
    await expect(page.getByTestId('player-item')).toHaveAttribute('data-name', 'Hosty');
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
