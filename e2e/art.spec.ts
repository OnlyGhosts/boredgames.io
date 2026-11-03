import { expect, test, type Page } from '@playwright/test';
import { GAME_LIST } from '../shared/platform/games';
import { coverage, decodePng, fragments, seeThrough, type Rgba } from './artPixels';
import { createParty } from './party';

/**
 * Every live game's picture on its lobby tile, pixel by pixel, on the real page: on the dark tile,
 * the light tile and the picked lilac tile, at a desktop's size (72px square) and a phone's (64px),
 * at device pixel ratios 1, 2 and 3. A picture is a 120-unit canvas in the soft shaded style
 * (GameArt.tsx), so that is 0.53 to 1.8 pixels a unit. Each one is checked whole (square, centred,
 * and inside its slot and its tile, so the tile never clips it), showing on every tile, with no
 * fleck on its own and nowhere the tile shows through inside it (artPixels.ts has the checks and
 * what each catches), and the page's pictures keep their gradients, patterns and clip paths to
 * themselves.
 */
test.describe.configure({ mode: 'serial' });

const LIVE = GAME_LIST.filter((g) => g.status === 'live');
/** The canvas every live picture is drawn on (GameArt.tsx's SHADED_VIEWBOX), in units. */
const CANVAS = 120;

const SCREENS = [
  { name: 'desktop at 1x', dpr: 1, size: 72, options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { name: 'desktop at 2x', dpr: 2, size: 72, options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  { name: 'phone 390 at 3x', dpr: 3, size: 64, options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'phone 320 at 3x', dpr: 3, size: 64, options: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'phone 320 at 2x', dpr: 2, size: 64, options: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'phone 320 at 1x', dpr: 1, size: 64, options: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

/** The tile's background, as the pixel it paints: "rgb(r, g, b)" to [r, g, b]. */
async function tileColour(page: Page, game: string): Promise<number[]> {
  const bg = await page.locator(`[data-testid="game-tile"][data-game="${game}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
  return (bg.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

for (const screen of SCREENS) {
  test(`every picture is whole and clean on the dark, light and picked tiles, ${screen.name}`, async ({ browser }) => {
    const context = await browser.newContext(screen.options);
    try {
      const page = await context.newPage();
      await createParty(page, 'Ada');
      const picker = page.getByTestId('game-picker');
      await expect(picker.locator('button[data-testid="game-tile"]')).toHaveCount(LIVE.length);
      // Every gradient, pattern and clip path on the page has an id of its own, and every picture's url(#…) finds its definition inside that same picture.
      const refs = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('svg[data-art] [id]')].map((el) => el.id);
        const unresolved: string[] = [];
        let count = 0;
        for (const svg of document.querySelectorAll('svg[data-art]')) {
          for (const el of svg.querySelectorAll('*')) {
            for (const attr of el.getAttributeNames()) {
              for (const [, id] of el.getAttribute(attr)!.matchAll(/url\(#([^)]+)\)/g)) {
                count++;
                if (!svg.querySelector(`#${CSS.escape(id)}`)) unresolved.push(`${svg.getAttribute('data-art')} ${attr}=url(#${id})`);
              }
            }
          }
        }
        return { duplicates: ids.filter((id) => document.querySelectorAll(`#${CSS.escape(id)}`).length !== 1), unresolved, count };
      });
      expect(refs.duplicates).toEqual([]);
      expect(refs.unresolved).toEqual([]);
      expect(refs.count).toBeGreaterThanOrEqual(LIVE.length);
      /** Each picture once on every tile it sits on: dark and light, picked and not. */
      const backgrounds: Record<string, Record<string, Rgba>> = {};
      let shots = 0;
      let pxPerUnit = 0;
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
            const button = picker.locator(`[data-testid="game-tile"][data-game="${g.id}"]`);
            const art = button.locator('svg[data-art]');
            const [box, slot, panel] = await Promise.all([art.boundingBox(), button.locator('.game-tile__art').boundingBox(), button.boundingBox()]);
            if (!box || !slot || !panel) throw new Error(`${label}: no box`);
            // Square and the size the tile gives it, even on the narrowest tile (three to a row on a 320px phone).
            expect(box.width, label).toBeCloseTo(screen.size, 1);
            expect(box.height, label).toBeCloseTo(screen.size, 1);
            // Centred across its slot, and inside the slot and the tile, so the tile never clips it.
            expect(Math.abs(box.x + box.width / 2 - (slot.x + slot.width / 2)), `${label}: centred`).toBeLessThanOrEqual(0.5);
            for (const outer of [slot, panel]) {
              expect(box.x, label).toBeGreaterThanOrEqual(outer.x);
              expect(box.y, label).toBeGreaterThanOrEqual(outer.y);
              expect(box.x + box.width, label).toBeLessThanOrEqual(outer.x + outer.width);
              expect(box.y + box.height, label).toBeLessThanOrEqual(outer.y + outer.height);
            }
            const img = decodePng(await art.screenshot());
            // The screenshot is the picture's own box, with the tile showing through: its corner is the tile's colour.
            expect(img.width, label).toBeGreaterThanOrEqual(Math.floor(box.width * screen.dpr));
            const tile = await tileColour(page, g.id);
            expect([img.data[0], img.data[1], img.data[2]].map((v, i) => Math.abs(v - tile[i]) <= 3), `${label}: the corner pixel is the tile`).toEqual([true, true, true]);
            // It shows on every tile (the picked lilac hides only what is drawn in that same lilac, Scribble's squiggle under its highlight).
            expect(coverage(img), `${label}: shows`).toBeGreaterThanOrEqual(0.1);
            pxPerUnit = (box.width * screen.dpr) / CANVAS;
            (backgrounds[g.id] ??= {})[`${picked ? 'picked ' : ''}${theme}`] ??= img;
            shots++;
          }
        }
      }
      expect(shots).toBe(2 * LIVE.length * LIVE.length);
      // The same picture on the four tiles: no fleck of it on its own, and wherever it is the picture, away from its outline, it looks the same, so no seam or sliver lets the tile through.
      for (const g of LIVE) {
        expect(Object.keys(backgrounds[g.id]).sort(), g.name).toEqual(['dark', 'light', 'picked dark', 'picked light']);
        const flecks = fragments(backgrounds[g.id], pxPerUnit).map((f) => `${f.kind} at ${f.at}: ${f.detail}`);
        expect(flecks, `${g.name}, ${screen.name}`).toEqual([]);
        const seams = seeThrough(backgrounds[g.id]).map((f) => `${f.kind} at ${f.at}: ${f.detail}`);
        expect(seams, `${g.name}, ${screen.name}`).toEqual([]);
      }
    } finally {
      await context.close();
    }
  });
}
