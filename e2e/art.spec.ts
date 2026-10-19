import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { GAME_LIST } from '../shared/platform/games';
import { artFlaws, decodePng, pixelsOf } from './artPixels';
import { createParty } from './party';

/**
 * Every game’s picture on its lobby tile, pixel by pixel, on the real page: on the dark tile, the
 * light tile and the picked lilac tile, at a desktop’s size (96px wide) and a phone’s (about 69 to
 * 91px), at device pixel ratios 1, 2 and 3. A picture is 64 units wide, so that is 1.1 to 4.5 pixels a
 * unit, where a slip of a fraction of a unit in the drawing renders as a hairline, a sliver or a
 * fleck (artPixels.ts has the checks and what each catches). The picked tile also swaps the
 * lilac fill for a paler one, so a lilac shape is a filled shape there, not an outline.
 */
test.describe.configure({ mode: 'serial' });

const tokens = readFileSync(new URL('../client/src/platform/styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string): string => {
  const hex = tokens.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];
  if (!hex) throw new Error(`no token --${name}`);
  return hex;
};
const FILLS = { lime: token('color-primary'), lilac: token('game-lilac'), lilacPicked: token('game-lilac-picked'), paper: token('game-paper') };
const LIVE = GAME_LIST.filter((g) => g.status === 'live');

const SCREENS = [
  { name: 'desktop at 1x', dpr: 1, options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { name: 'desktop at 2x', dpr: 2, options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  { name: 'phone 390 at 3x', dpr: 3, options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'phone 320 at 3x', dpr: 3, options: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'phone 320 at 2x', dpr: 2, options: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'phone 320 at 1x', dpr: 1, options: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

/** The tile's background, as the pixel it paints: "rgb(r, g, b)" to [r, g, b]. */
async function tileColour(page: Page, game: string): Promise<number[]> {
  const bg = await page.locator(`[data-testid="game-tile"][data-game="${game}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
  return (bg.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

for (const screen of SCREENS) {
  test(`every picture is clean on the dark, light and picked tiles, ${screen.name}`, async ({ browser }) => {
    const context = await browser.newContext(screen.options);
    try {
      const page = await context.newPage();
      await createParty(page, 'Ada');
      const picker = page.getByTestId('game-picker');
      await expect(picker.locator('button[data-testid="game-tile"]')).toHaveCount(LIVE.length);
      /** How much of each picture is the brand lilac when its tile is not picked, and the paler lilac when it is: the same shapes, so about the same area. */
      const lilac: Record<string, number> = {};
      const paler: Record<string, number> = {};
      let shots = 0;
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        for (const pick of LIVE) {
          await picker.locator(`[data-testid="game-tile"][data-game="${pick.id}"]`).click();
          await expect(picker).toHaveAttribute('data-game', pick.id);
          await expect(picker.locator('.game-tile.is-selected')).toHaveAttribute('data-game', pick.id);
          if (!screen.options.isMobile) await page.mouse.move(0, 0);
          // The tiles' colours settle (a 100ms transition) before anything is measured.
          await page.waitForTimeout(250);
          for (const g of LIVE) {
            const picked = g.id === pick.id;
            const label = `${g.name} on the ${picked ? 'picked' : theme} tile, ${screen.name}`;
            const art = picker.locator(`[data-testid="game-tile"][data-game="${g.id}"] svg[data-art]`);
            const box = await art.boundingBox();
            if (!box) throw new Error(`${label}: no box`);
            const img = decodePng(await art.screenshot());
            // The screenshot is the picture's own box, with the tile showing through: its corner is the tile's colour.
            expect(img.width, label).toBeGreaterThanOrEqual(Math.floor(box.width * screen.dpr));
            const tile = await tileColour(page, g.id);
            expect([img.data[0], img.data[1], img.data[2]].map((v, i) => Math.abs(v - tile[i]) <= 3), `${label}: the corner pixel is the tile`).toEqual([true, true, true]);
            const pxPerUnit = (box.width * screen.dpr) / 64;
            // The narrowest tile (three to a row on a 320px phone) still gives the picture about 69px.
            expect(box.width, label).toBeGreaterThanOrEqual(68);
            const flaws = artFlaws(img, pxPerUnit, Object.values(FILLS));
            expect(flaws.map((f) => `${f.kind} at ${f.at}: ${f.detail}`), label).toEqual([]);
            // The paler lilac shows only on the picked tile. (The brand lilac inside the picture on the picked tile is not counted: a pocket
            // of tile between the marker and its squiggle is that colour too, and the area check below is what tells a filled shape from one
            // filled in the tile's colour.)
            const pale = pixelsOf(img, FILLS.lilacPicked);
            if (picked) paler[g.id] = Math.max(paler[g.id] ?? 0, pale / pxPerUnit ** 2);
            else {
              expect(pale, `${label}: no picked lilac off the picked tile`).toBe(0);
              lilac[g.id] = Math.max(lilac[g.id] ?? 0, pixelsOf(img, FILLS.lilac) / pxPerUnit ** 2);
            }
            shots++;
          }
        }
      }
      expect(shots).toBe(2 * LIVE.length * LIVE.length);
      // A picture's lilac shapes keep their area on the picked tile, in the paler lilac (so they are filled there, not outlines).
      for (const g of LIVE) {
        if (lilac[g.id] > 0) expect(paler[g.id], `${g.name}: its lilac shapes (${lilac[g.id].toFixed(0)} units square) are filled on the picked tile`).toBeGreaterThanOrEqual(lilac[g.id] * 0.8);
        else expect(paler[g.id], `${g.name}: no lilac shapes, so none on the picked tile`).toBe(0);
      }
    } finally {
      await context.close();
    }
  });
}
