import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { GAMES } = await import('./index');
const { GAME_LIST } = await import('@shared/platform/games');
const { registerGames } = await import('../platform/registry');
const { GamePicker } = await import('../platform/components/GamePicker');
const { ART, ART_VIEWBOX, EDGE_WIDTH } = await import('../platform/components/GameArt');
const { room } = await import('../test/fixtures');
const { HERO, HERO_EDGE, RulesHeroArt } = await import('../platform/components/RulesHero');

const tiles = (html: string): string[] => html.split('data-testid="game-tile"').slice(1);

/** Every element in a picture’s markup with its attributes, in order. */
function elements(html: string): { tag: string; attrs: Record<string, string> }[] {
  return [...html.matchAll(/<([a-z]+)((?:\s[a-z-]+="[^"]*")*)\s*\/?>/g)].map(([, tag, attrs]) => ({
    tag,
    attrs: Object.fromEntries([...attrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  }));
}

/** The two edges, deep lime and deep lilac: the only outline colours a picture has. */
const EDGES: string[] = [ART.edgeLime, ART.edgeLilac];
/** A lime or lilac shape carries the deep edge of its own colour. */
const EDGE_OF: Record<string, string> = { [ART.lime]: ART.edgeLime, [ART.lilac]: ART.edgeLilac };
/** What a detail inside a shape may be filled with: ink or one of the two edge colours, never a fill of its own and never grey. */
const DETAILS: string[] = [ART.ink, ...EDGES];

/** WCAG contrast between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue (degrees) and saturation (0 to 1) of a #rrggbb colour, as HSL has them. */
function hueSat(hex: string): { hue: number; sat: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { hue: 0, sat: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat: d / (1 - Math.abs(2 * l - 1)) };
}

/** CIELAB (D65) of a #rrggbb colour: L* is how light it looks (0 black, 100 white), C* how colourful (0 grey). */
function lab(hex: string): { L: number; a: number; b: number; C: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f);
  const [L, A, B] = [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  return { L, a: A, b: B, C: Math.hypot(A, B) };
}

/** How far apart two colours look (CIE76 delta E): about 2 is a just-visible difference, 50 two plainly different colours. */
function deltaE(x: string, y: string): number {
  const [p, q] = [lab(x), lab(y)];
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** tokens.css, and every value it gives a custom property. */
const tokens = readFileSync(fileURLToPath(new URL('../platform/styles/tokens.css', import.meta.url)), 'utf8');
const values = (name: string): string[] => [...tokens.matchAll(new RegExp(`--${name}: (#[0-9a-f]{6});`, 'g'))].map((m) => m[1]);
/** A token with one value, the same in both themes. */
function hex(name: string): string {
  expect(new Set(values(name)), name).toHaveProperty('size', 1);
  return values(name)[0];
}

describe('every game’s picture', () => {
  it('is an inline SVG in the GameArt frame, hidden from assistive tech (the name is beside it), drawn in tokens only', () => {
    for (const g of GAME_LIST) {
      const html = renderToString(createElement(GAMES[g.id].Art));
      expect(html, g.id).toMatch(/^<svg /);
      expect(html, g.id).toContain('aria-hidden="true"');
      expect(html, g.id).toContain(`data-art="${g.id}"`);
      expect(html, g.id).toContain(`viewBox="${ART_VIEWBOX}"`);
      // No shadow: a picture is its shapes and nothing else (GameArt.tsx says why), so nothing is drawn twice and no copy of a shape can peek out beside it.
      expect(html, g.id).not.toContain('game-art__shadow');
      const markup = html.match(/<(?:path|rect|circle|ellipse|line|polygon)\b[^>]*>/g) ?? [];
      expect(new Set(markup).size, `${g.id} draws nothing twice`).toBe(markup.length);
      // The mascots' palette comes through the theme tokens, never a raw colour, so both themes draw it alike.
      expect(html, g.id).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      for (const colour of html.match(/(?:fill|stroke)="[^"]+"/g) ?? []) expect(colour, g.id).toMatch(/^(?:fill|stroke)="(?:none|var\(--[a-z-]+\))"$/);
      // And only the palette’s own tokens: nothing else (no grey) can creep into a picture.
      for (const [, colour] of html.matchAll(/(?:fill|stroke)="([^"]+)"/g)) expect(['none', ...Object.values(ART)], `${g.id} ${colour}`).toContain(colour);
    }
  });

  it('has a palette with no grey: three fills, the deep lime and deep lilac edges and ink for details', () => {
    expect(Object.keys(ART).sort()).toEqual(['edgeLilac', 'edgeLime', 'ink', 'lilac', 'lime', 'paper']);
    expect(ART).not.toHaveProperty('edgePaper');
    expect(ART).not.toHaveProperty('graphite');
    // Every edge in the palette is one of the two edge tokens.
    for (const [key, value] of Object.entries(ART)) if (key.startsWith('edge')) expect(['var(--game-edge-lime)', 'var(--game-edge-lilac)'], key).toContain(value);
    expect(tokens).not.toContain('--game-edge-paper');
    expect(tokens).not.toContain('--game-graphite');
    // The lilac fill is a game token of its own, the brand lilac, because the picked tile swaps it (the lime never needs that: no tile is lime).
    expect(ART.lilac).toBe('var(--game-lilac)');
    expect(ART.lime).toBe('var(--color-primary)');
    expect(hex('game-lilac')).toBe(hex('color-secondary'));
    // Every edge token there is (the picked tile’s deeper cuts included) resolves to lime or lilac: the hue of its fill, well saturated, never grey.
    const edgeTokens = [...new Set([...tokens.matchAll(/--(game-edge-[a-z-]+):/g)].map((m) => m[1]))].sort();
    expect(edgeTokens).toEqual(['game-edge-lilac', 'game-edge-lilac-picked', 'game-edge-lime', 'game-edge-lime-picked']);
    for (const name of edgeTokens) {
      const fill = hueSat(hex(name.includes('lime') ? 'color-primary' : 'color-secondary'));
      const edge = hueSat(hex(name));
      expect(Math.abs(edge.hue - fill.hue), `${name} hue`).toBeLessThanOrEqual(3);
      expect(edge.sat, `${name} saturation`).toBeGreaterThanOrEqual(0.25);
      // However deep the cut, it stays a colour: vivid (C* 35 or more; a grey is near 0) and never black (L* 20 or more; ink is 6.6).
      expect(lab(hex(name)).C, `${name} chroma`).toBeGreaterThanOrEqual(35);
      expect(lab(hex(name)).L, `${name} lightness`).toBeGreaterThanOrEqual(20);
    }
  });

  it('has no black or grey outline: every shape carries a deep lime or deep lilac edge, a white one borrowed from a colour beside it, and ink is only ever a filled detail', () => {
    for (const g of GAME_LIST) {
      const html = renderToString(createElement(GAMES[g.id].Art));
      // Ink never draws a line: an ink stroke would meet the dark tile.
      expect(html, g.id).not.toContain(`stroke="${ART.ink}"`);
      const drawn = elements(html).filter((e) => e.tag !== 'svg' && (e.attrs.fill || e.attrs.stroke));
      let shapes = 0;
      const coloured = new Set<string>();
      const borrowed: string[] = [];
      for (const { tag, attrs } of drawn) {
        const what = `${g.id} <${tag} fill=${attrs.fill} stroke=${attrs.stroke}>`;
        if (attrs.fill && (EDGE_OF[attrs.fill] || attrs.fill === ART.paper)) {
          // A filled shape: rimmed 2.2 wide, a lime or lilac one in the deep shade of its own colour, a white one in deep lime or deep lilac.
          shapes++;
          expect(attrs['stroke-width'], what).toBe(String(EDGE_WIDTH));
          if (attrs.fill === ART.paper) {
            expect(EDGES, what).toContain(attrs.stroke);
            borrowed.push(attrs.stroke!);
          } else {
            expect(attrs.stroke, what).toBe(EDGE_OF[attrs.fill]);
            coloured.add(attrs.stroke!);
          }
        } else if (attrs.fill === 'none') {
          // A line: a fill colour over its own edge (Line), or a printed line in an edge colour.
          expect([...Object.keys(EDGE_OF), ...EDGES], what).toContain(attrs.stroke);
          if (EDGES.includes(attrs.stroke!)) coloured.add(attrs.stroke!);
        } else {
          // A detail: no edge of its own, in ink or an edge colour.
          expect(DETAILS, what).toContain(attrs.fill);
          expect(attrs.stroke, what).toBeUndefined();
        }
      }
      expect(shapes, g.id).toBeGreaterThan(0);
      // A white shape borrows the edge of a lime or lilac shape (or line) in the same picture, never one of its own.
      for (const edge of borrowed) expect([...coloured], `${g.id} white shape edged ${edge}`).toContain(edge);
      // Every Line’s fill sits on an edge of its own colour, 2.2 wider each side.
      const lines = drawn.filter((e) => e.attrs.fill === 'none' && EDGE_OF[e.attrs.stroke ?? '']);
      for (const line of lines) {
        const edge = drawn.find((e) => e.attrs.d === line.attrs.d && e.attrs.stroke === EDGE_OF[line.attrs.stroke!]);
        expect(Number(edge?.attrs['stroke-width']), g.id).toBeCloseTo(Number(line.attrs['stroke-width']) + 2 * EDGE_WIDTH);
      }
    }
  });

  it('draws its edges in tokens that rim their own fills as firmly as the lime does, read on the white tile and the paper, stand off the dark tile by their colour, and on the picked lilac tile cut deeper while the lilac fill goes paler', () => {
    // A tile is the panel: graphite on dark, white on light; the picked tile is the lilac fill.
    const tiles = values('color-surface');
    expect(tiles).toEqual(['#20221f', '#ffffff']);
    const [dark, white] = tiles;
    const lilacTile = hex('color-secondary');
    expect(lilacTile).toBe('#a699d5');
    const paper = hex('game-paper');
    const fills = { lime: hex('color-primary'), lilac: hex('game-lilac') };
    // The lilac edge was #7466ad: 1.92:1 on its fill and only 19 L* under it, a soft rim beside the lime's firm one, so it is cut
    // to #4e3d94, the lime edge's step (34 L* under its fill); the picked tile's lilac cut goes deeper with it, #4f408c to #3d2f74.
    expect({ lime: hex('game-edge-lime'), lilac: hex('game-edge-lilac'), limePicked: hex('game-edge-lime-picked'), lilacPicked: hex('game-edge-lilac-picked') }).toEqual({
      lime: '#6b8a1e',
      lilac: '#4e3d94',
      limePicked: '#405311',
      lilacPicked: '#3d2f74',
    });
    const step = (colour: 'lime' | 'lilac') => lab(fills[colour]).L - lab(hex(`game-edge-${colour}`)).L;
    for (const colour of ['lime', 'lilac'] as const) {
      const fill = fills[colour];
      const edge = hex(`game-edge-${colour}`);
      // A firm outline round its own fill, the lime edge’s (2.91:1, 34.5 L* under #c7e976) the measure.
      expect(contrast(edge, fill), `${colour} edge on its fill`).toBeGreaterThanOrEqual(2.9);
      expect(step(colour), `${colour} edge's step under its fill`).toBeGreaterThanOrEqual(34);
      // On the white tile, and on the paper: a white shape borrows either edge, so both rim it clearly.
      expect(contrast(edge, white), `${colour} edge on white`).toBeGreaterThanOrEqual(3);
      expect(contrast(edge, paper), `${colour} edge on paper`).toBeGreaterThanOrEqual(3);
      // On the dark tile the shape’s fill draws its outline against the graphite, and the edge round it reads by its colour: a deep
      // lilac cannot keep 3:1 on the graphite (1.85:1), but it is a vivid purple far from it (the lilac edge 60, the lime 68 delta E;
      // the ink that sank into it was 6.5) and lighter than it, never a dark line.
      expect(contrast(fill, dark), `${colour} fill on the dark tile`).toBeGreaterThanOrEqual(3);
      expect(deltaE(edge, dark), `${colour} edge apart from the dark tile`).toBeGreaterThanOrEqual(50);
      expect(lab(edge).L - lab(dark).L, `${colour} edge lighter than the dark tile`).toBeGreaterThanOrEqual(15);
      // On the picked tile the deeper cut parts every shape, and every shadow drawn in it, from the lilac, and still rims its own fill and the paper.
      const picked = hex(`game-edge-${colour}-picked`);
      expect(contrast(picked, lilacTile), `picked ${colour} edge on the lilac tile`).toBeGreaterThanOrEqual(3);
      expect(contrast(picked, fill), `picked ${colour} edge on its fill`).toBeGreaterThanOrEqual(3);
      expect(contrast(picked, paper), `picked ${colour} edge on paper`).toBeGreaterThanOrEqual(3);
      expect(contrast(picked, lilacTile), `picked ${colour} edge is deeper`).toBeGreaterThan(contrast(edge, lilacTile));
    }
    // The lilac rim is as firm as the lime one, not the faded one it was.
    expect(step('lilac')).toBeGreaterThanOrEqual(step('lime') - 0.5);
    expect(contrast(hex('game-edge-lilac'), fills.lilac)).toBeGreaterThanOrEqual(contrast(hex('game-edge-lime'), fills.lime));
    // On the picked tile the lilac fill is a paler cut of the same lilac (a shape there, not an outline), still lilac rather than paper, and both picked edges rim it.
    const pickedFill = hex('game-lilac-picked');
    expect(pickedFill).toBe('#cdc4ee');
    expect(contrast(pickedFill, lilacTile), 'picked lilac fill on the lilac tile').toBeGreaterThanOrEqual(1.5);
    expect(lab(pickedFill).L - lab(lilacTile).L, 'picked lilac fill lighter than the tile').toBeGreaterThanOrEqual(14);
    expect(deltaE(pickedFill, lilacTile), 'picked lilac fill apart from the tile').toBeGreaterThanOrEqual(17);
    expect(Math.abs(hueSat(pickedFill).hue - hueSat(lilacTile).hue), 'picked lilac fill is the same lilac').toBeLessThanOrEqual(3);
    expect(hueSat(pickedFill).sat).toBeGreaterThanOrEqual(0.25);
    expect(deltaE(pickedFill, paper), 'picked lilac fill is not paper').toBeGreaterThanOrEqual(25);
    expect(lab(pickedFill).L).toBeLessThanOrEqual(lab(paper).L - 10);
    for (const colour of ['lime', 'lilac'] as const) expect(contrast(hex(`game-edge-${colour}-picked`), pickedFill), `picked ${colour} edge on the picked lilac fill`).toBeGreaterThanOrEqual(3);
    // No shadow: components.css draws nothing under or behind a picture, and the only place a picture's tokens change is the picked tile (lobby.css), which swaps both edges and the lilac fill together.
    const components = readFileSync(fileURLToPath(new URL('../platform/styles/components.css', import.meta.url)), 'utf8');
    expect(components).not.toContain('game-art__shadow');
    const artRules = [...components.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*game-art[^{}]*)\{([^}]*)\}/g)];
    expect(artRules.map((m) => m[1].trim())).toEqual(['.game-art']);
    expect(artRules[0][2].trim()).toBe('display: block;');
    const lobby = readFileSync(fileURLToPath(new URL('../platform/styles/lobby.css', import.meta.url)), 'utf8');
    const picked = lobby.slice(lobby.indexOf('.game-tile.is-selected {'), lobby.indexOf('}', lobby.indexOf('.game-tile.is-selected {')));
    expect(picked).toContain('--game-edge-lime: var(--game-edge-lime-picked);');
    expect(picked).toContain('--game-edge-lilac: var(--game-edge-lilac-picked);');
    expect(picked).toContain('--game-lilac: var(--game-lilac-picked);');
    expect(tokens.match(/--game-lilac(?:-picked)?:/g)).toEqual(['--game-lilac:', '--game-lilac-picked:']);
  });

  it('sits on the half-unit grid, draws letters as paths, keeps every line 1.5 units or wider and says even-odd wherever a path has a second subpath', () => {
    // A tile shows a picture at 1.1 to 4.5 pixels a unit, where a slip of a fraction of a unit renders as a hairline or a sliver (GameArt.tsx):
    // shapes and lines (anything with an edge) sit on the half-unit grid, so two that touch share the coordinate they touch on; a transform
    // turns about a grid point or shifts by grid steps; a letter is a path (text takes subpixel smoothing and shows coloured fringes); no
    // deliberate line (a printed frame, a Line's fill) is thinner than 1.5 units; and a path with more than one subpath says even-odd, because
    // under the default nonzero rule two subpaths wound opposite ways cancel where they overlap (the spade once lost the top of its stem that way).
    const onGrid = (n: number) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
    const numbers = (text: string) => (text.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (const g of GAME_LIST) {
      const html = renderToString(createElement(GAMES[g.id].Art));
      expect(html, g.id).not.toMatch(/<text[\s>]/);
      let shapes = 0;
      for (const { tag, attrs } of elements(html)) {
        const what = `${g.id} <${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>`;
        if (attrs.stroke) {
          shapes++;
          for (const key of ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry']) if (attrs[key] !== undefined) expect(onGrid(Number(attrs[key])), `${what}: ${key} on the half-unit grid`).toBe(true);
          if (attrs.d) for (const n of numbers(attrs.d)) expect(onGrid(n), `${what}: ${n} in d on the half-unit grid`).toBe(true);
          if (attrs.fill === 'none') expect(Number(attrs['stroke-width']), `${what}: no line thinner than 1.5`).toBeGreaterThanOrEqual(1.5);
        }
        for (const [, kind, args] of attrs.transform?.matchAll(/(rotate|translate)\(([^)]*)\)/g) ?? []) {
          for (const n of kind === 'rotate' ? numbers(args).slice(1) : numbers(args)) expect(onGrid(n), `${what}: ${kind} on the half-unit grid`).toBe(true);
        }
        if (attrs.d && (attrs.d.match(/m/gi) ?? []).length > 1) expect(attrs['fill-rule'], `${what}: a second subpath needs even-odd`).toBe('evenodd');
      }
      expect(shapes, g.id).toBeGreaterThan(0);
    }
  });

  it('leans Poker’s chip on the stack with its outline crossing every outline of the stack at 30 degrees or more, never grazing one', () => {
    // The leaning chip is the one place two curved outlines of different shapes meet. Where two edges cross at a shallow angle, or run
    // close without crossing, the fill between them tapers to a hairline (GameArt.tsx): the chip once met the top face's rim at 4
    // degrees, a tangency that read clean only because the two dark edges lay on each other, and a nudge of a unit or two would have
    // opened a lime sliver between them. So this measures, in the picture's units: the chip's outline (sampled every quarter degree,
    // tilted as drawn) against the top face, each side's lower rim and the stack's two ends, the angle between the two tangents at every
    // crossing, and the distance where they do not cross (two 2.2 edges and 1.5 of fill between is the least that stays clean).
    const html = renderToString(createElement(GAMES.poker.Art));
    const stroked = elements(html).filter((e) => e.attrs.stroke);
    const num = (v: string | undefined) => Number(v);
    // A side of the stack: `M<left> <top>a<rx> <ry> 0 0 0 <2rx> 0v<depth>...`, the front half of its rim at `top` and again `depth` lower.
    const sides = stroked.map((e) => e.attrs.d?.match(/^M([\d.]+) ([\d.]+)a([\d.]+) ([\d.]+) 0 0 0 ([\d.]+) 0v([\d.]+)a/)).filter((m): m is RegExpMatchArray => m != null).map((m) => ({ left: num(m[1]), top: num(m[2]), rx: num(m[3]), ry: num(m[4]), depth: num(m[6]) }));
    expect(sides.length).toBeGreaterThanOrEqual(2);
    const [left, rx, ry] = [sides[0].left, sides[0].rx, sides[0].ry];
    for (const side of sides) expect([side.left, side.rx, side.ry]).toEqual([left, rx, ry]);
    const [top, chip] = stroked.filter((e) => e.tag === 'ellipse');
    expect([num(top.attrs.cx), num(top.attrs.cy), num(top.attrs.rx), num(top.attrs.ry)]).toEqual([left + rx, Math.min(...sides.map((s) => s.top)), rx, ry]);
    const tilt = html.match(/<g transform="rotate\((-?[\d.]+) (-?[\d.]+) (-?[\d.]+)\)"><ellipse /);
    expect(tilt, 'the chip is the ellipse in the tilted group').toBeTruthy();
    const [angle, px, py] = tilt!.slice(1).map(Number);
    expect([px, py]).toEqual([num(chip.attrs.cx), num(chip.attrs.cy)]);
    const outline: [number, number][] = [];
    for (let a = 0; a < 360; a += 0.25) {
      const [x, y] = [num(chip.attrs.rx) * Math.cos((a * Math.PI) / 180), num(chip.attrs.ry) * Math.sin((a * Math.PI) / 180)];
      const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
      outline.push([px + x * c - y * s, py + x * s + y * c]);
    }
    const at = (i: number) => outline[(i + outline.length) % outline.length];
    const tangent = (i: number): [number, number] => [at(i + 1)[0] - at(i - 1)[0], at(i + 1)[1] - at(i - 1)[1]];
    const degrees = (sin: number) => (Math.asin(Math.min(1, sin)) * 180) / Math.PI;
    /** How the chip's outline meets one outline of the stack: `f` is signed, zero on it; `grad` its gradient (the outline's normal); `on` says which samples count. */
    const meets = (f: (p: [number, number]) => number, grad: (p: [number, number]) => [number, number], on: (p: [number, number]) => boolean) => {
      const angles: number[] = [];
      let closest = Infinity;
      for (let i = 0; i < outline.length; i++) {
        const [p, q] = [at(i), at(i + 1)];
        if (!on(p) && !on(q)) continue;
        const g = grad(p);
        const gl = Math.hypot(...g);
        closest = Math.min(closest, Math.abs(f(p)) / gl);
        if (f(p) < 0 !== f(q) < 0) {
          const t = tangent(i);
          angles.push(degrees(Math.abs(t[0] * g[0] + t[1] * g[1]) / (Math.hypot(...t) * gl)));
        }
      }
      return { angles, closest };
    };
    const ellipse = (cx: number, cy: number, lowerHalf: boolean) =>
      meets(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 - 1, ([x, y]) => [(2 * (x - cx)) / rx ** 2, (2 * (y - cy)) / ry ** 2], ([, y]) => !lowerHalf || y >= cy);
    const bottom = Math.max(...sides.map((s) => s.top + s.depth));
    const end = (x: number) => meets(([x0]) => x0 - x, () => [1, 0], ([, y]) => y >= num(top.attrs.cy) && y <= bottom);
    const outlines: Record<string, ReturnType<typeof meets>> = { 'top face': ellipse(left + rx, num(top.attrs.cy), false), 'right end': end(left + 2 * rx), 'left end': end(left) };
    for (const rim of new Set(sides.map((s) => s.top + s.depth))) outlines[`rim at ${rim}`] = ellipse(left + rx, rim, true);
    for (const [name, { angles, closest }] of Object.entries(outlines)) {
      for (const a of angles) expect(a, `the chip crosses the ${name} at ${a.toFixed(1)} degrees`).toBeGreaterThanOrEqual(30);
      if (!angles.length) expect(closest, `the chip clears the ${name}`).toBeGreaterThanOrEqual(2 * EDGE_WIDTH + 1.5);
    }
    // And it does lean on the stack: over the top face's rim and the stack's right end, well inside the picture.
    expect(outlines['top face'].angles.length).toBeGreaterThanOrEqual(2);
    expect(outlines['right end'].angles).toHaveLength(1);
    for (const [x, y] of outline) {
      expect(x + EDGE_WIDTH / 2).toBeLessThanOrEqual(64);
      expect(y + EDGE_WIDTH / 2).toBeLessThanOrEqual(46);
      expect(y - EDGE_WIDTH / 2).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows on its lobby tile: every live game for the host, the one current game for a guest', () => {
    registerGames(GAMES);
    const host = renderToString(createElement(GamePicker, { room: room(), isHost: true, game: null }));
    const live = GAME_LIST.filter((g) => g.status === 'live');
    expect(tiles(host)).toHaveLength(live.length);
    for (const tile of tiles(host)) {
      const id = tile.match(/data-game="([a-z]+)"/)?.[1];
      expect(tile).toContain(`<span class="game-tile__art"><svg class="game-art" viewBox="${ART_VIEWBOX}" aria-hidden="true" focusable="false" data-art="${id}">`);
      expect(tile.indexOf('data-art=')).toBeLessThan(tile.indexOf('class="game-tile__name"'));
    }
    const guest = renderToString(createElement(GamePicker, { room: room({ gameId: 'poker' }), isHost: false, game: null }));
    expect(tiles(guest)).toHaveLength(1);
    expect(guest.match(/data-art="/g)).toHaveLength(1);
    expect(guest).toContain('data-art="poker"');
  });
});

describe('How to play’s drawn heroes', () => {
  /** The games whose hero the platform draws in the tiles' flat style: Scribble's canvas, Quip Game's bubbles. */
  const drawn = GAME_LIST.filter((g) => ['canvas', 'quips'].includes(GAMES[g.id].rules.hero.kind));

  it('draws the canvas and the bubbles flat in the accent, lime and paper, each shape rimmed in the deep cut of its own fill, ink only inside a shape', () => {
    expect(drawn.map((g) => g.id).sort()).toEqual(['quipgame', 'scribble']);
    // A fill's edge: the accent's deep cut, lime's, and a white shape borrows either.
    const EDGE: Record<string, string[]> = { [HERO.accent]: [HERO.edge], [HERO.lime]: [HERO.limeEdge], [HERO.paper]: [HERO.edge, HERO.limeEdge] };
    for (const g of drawn) {
      const { hero } = GAMES[g.id].rules;
      const html = renderToString(createElement(RulesHeroArt, { hero, meta: g }));
      const drawing = html.slice(html.indexOf('<svg class="rules-hero__drawing"'), html.lastIndexOf('</svg>') + 6);
      // The sticker shadow: the drawing once more under itself (lobby.css fills it in each shape's edge colour).
      expect(drawing, g.id).toContain('class="rules-hero__shadow"');
      expect(drawing, g.id).toContain(`transform="translate(${HERO_EDGE} ${HERO_EDGE})"`);
      // Tokens only, from the hero's palette: no raw colour, no grey, no black line.
      expect(drawing, g.id).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      for (const [, colour] of drawing.matchAll(/(?:fill|stroke)="([^"]+)"/g)) expect(['none', ...Object.values(HERO)], `${g.id} ${colour}`).toContain(colour);
      expect(drawing, g.id).not.toContain(`stroke="${HERO.ink}"`);
      let shapes = 0;
      for (const { tag, attrs } of elements(drawing)) {
        if (!attrs.fill) continue;
        const what = `${g.id} <${tag} fill=${attrs.fill} stroke=${attrs.stroke}>`;
        if (!attrs.stroke) {
          // A detail inside a shape (a door, a line of text, the tick): ink or an edge colour, no edge, no shadow.
          expect([HERO.ink, HERO.edge, HERO.limeEdge], what).toContain(attrs.fill);
          expect(attrs['data-detail'], what).toBe('');
          continue;
        }
        shapes++;
        expect(EDGE[attrs.fill], what).toContain(attrs.stroke);
        expect(attrs['stroke-width'], what).toBe(String(HERO_EDGE));
        // Its shadow takes the same edge colour.
        expect(attrs.style, what).toBe(`--edge:${attrs.stroke}`);
      }
      expect(shapes, g.id).toBeGreaterThan(3);
      // The key shapes are marked, so the e2e check can keep the badge clear of them.
      expect(drawing.match(/data-key="/g)?.length ?? 0, g.id).toBeGreaterThanOrEqual(3);
    }
    const lobby = readFileSync(fileURLToPath(new URL('../platform/styles/lobby.css', import.meta.url)), 'utf8');
    expect(lobby).toContain('.rules-hero__shadow [data-detail] {\n  display: none;\n}');
    expect(lobby).toContain('.rules-hero__shadow [stroke] {\n  fill: var(--edge);\n  stroke: var(--edge);\n}');
    // The old thin line drawings and their grey canvas edge are gone.
    for (const old of ['.rules-hero__canvas', '.rules-hero__pencil', '.rules-hero__quips', '--shadow-pencil']) expect(lobby + tokens, old).not.toContain(old);
  });

  it('rims them in a deep cut of the accent’s own hue that reads on the paper and on the hero’s wash in both themes', () => {
    const paper = hex('game-paper');
    for (const g of drawn) {
      const accent = hex(`game-${g.id}`);
      const edge = hex(`game-${g.id}-edge`);
      expect(contrast(edge, paper), `${g.id} edge on paper`).toBeGreaterThanOrEqual(3);
      expect(contrast(edge, accent), `${g.id} edge on its accent`).toBeGreaterThanOrEqual(1.6);
      // The hero's wash runs from the accent's soft cut to the raised surface, in each theme.
      for (const wash of [...values(`game-${g.id}-soft`), ...values('color-surface-2')]) expect(contrast(edge, wash), `${g.id} edge on ${wash}`).toBeGreaterThanOrEqual(3);
      // The same hue as the accent, deeper and well saturated: never grey.
      expect(Math.abs(hueSat(edge).hue - hueSat(accent).hue), `${g.id} edge hue`).toBeLessThanOrEqual(12);
      expect(hueSat(edge).sat, `${g.id} edge saturation`).toBeGreaterThanOrEqual(0.25);
    }
  });
});
