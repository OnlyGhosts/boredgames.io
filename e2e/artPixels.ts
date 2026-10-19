import { inflateSync } from 'node:zlib';

/**
 * Pixel checks on a screenshot of a game tile's picture (art.spec.ts): the flaws a flat picture
 * with a 2.2-unit edge round every shape can show when it is drawn at a few pixels a unit. The
 * picture is 64 units wide and a tile shows it about 69 to 96px wide, so at device pixel ratios 1
 * to 3 a unit is 1.1 to 4.5 pixels, and a slip of a fraction of a unit (a shape's copy peeking out beside
 * it, two outlines 0.2 apart, a point not quite on its neighbour) renders as a hairline, a sliver
 * or a lone fleck of colour. Three checks, all against the tile's own colour (the pixel in the
 * screenshot's corner, and every pixel of that colour joined to the border) and the picture's fills:
 * - hairline: a line, light or dark, narrower than 0.9 units that runs 2 units or more, between
 *   wider areas on both sides. Every deliberate line in a picture (a card back's frame, a chip's
 *   ring, an "A"'s crossbar) is 1.5 units or more; a wedge where two edges meet at a point is narrow
 *   for less than 2 units. Measured at 2 px a unit or more, where 0.9 units is 2 px or wider; at 1
 *   px a unit a hairline and a 1.5-unit line both fill one pixel.
 * - fill on tile: a solid patch of a fill colour (lime, lilac, paper) within two pixels of the
 *   tile, with at most one blended pixel between. Every fill is rimmed by its edge, 2.2 units wide
 *   (two pixels and more), so a fill that close to the tile has slipped outside its edge (a nib past
 *   its cone, a line's colour wider than its edge). A fill the tile's own colour is left out.
 * - fragment: a piece of the picture smaller than 1.5 units square on its own, clear of the rest.
 */

export interface Rgba {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes a pixel. */
  data: Uint8Array;
}

/** Decodes an 8-bit RGB or RGBA PNG without interlacing (what a Playwright screenshot is). */
export function decodePng(png: Buffer): Rgba {
  if (png.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  for (let pos = 8; pos < png.length; ) {
    const len = png.readUInt32BE(pos);
    const kind = png.toString('latin1', pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      [depth, type, interlace] = [body[8], body[9], body[12]];
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  const bpp = type === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = cur[x * bpp];
      data[o + 1] = cur[x * bpp + 1];
      data[o + 2] = cur[x * bpp + 2];
      data[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data };
}

export interface Flaw {
  kind: 'hairline' | 'fill on tile' | 'fragment';
  /** Where, in device pixels of the screenshot. */
  at: string;
  detail: string;
}

const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** CIELAB of an sRGB colour: L* is how light it looks, a* and b* its colour. */
function lab(r: number, g: number, b: number): [number, number, number] {
  const [rl, gl, bl] = [LIN[r], LIN[g], LIN[b]];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047);
  const y = f(0.2126 * rl + 0.7152 * gl + 0.0722 * bl);
  const z = f((0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** A pixel is a colour when it matches to within this much a channel: the colour itself, not a blend with a neighbour. */
const TOLERANCE = 3;
/** A fill colour this close (CIE76 delta E) to the tile is the tile, and left out of the fill check. */
const SAME_AS_TILE = 12;
/** A fill pixel with a tile pixel this close (Chebyshev) has no edge between them. */
const FILL_REACH = 2;
/** The lightness step (L*) a line has to make against both sides to count. */
const STEP = 8;
/** A hairline is narrower than this many units; a wedge is narrow for less than LENGTH units. */
const WIDTH = 0.9;
const LENGTH = 2;
/** Measured in units: how far a hairline can be told from a 1.5-unit line. */
const HAIRLINE_MIN_SCALE = 2;
/** A piece of the picture on its own smaller than this many units square is a fleck. */
const FRAGMENT_UNITS = 1.5;

const near = (data: Uint8Array, i: number, rgb: ArrayLike<number>): boolean =>
  Math.abs(data[i * 4] - rgb[0]) <= TOLERANCE && Math.abs(data[i * 4 + 1] - rgb[1]) <= TOLERANCE && Math.abs(data[i * 4 + 2] - rgb[2]) <= TOLERANCE;

/**
 * How many pixels of the picture are a colour (#rrggbb), to within 3 a channel: the tile around the
 * picture is left out, so on the lilac tile this counts the lilac inside the picture's outlines (a
 * shape filled in the tile's own colour, which is what the picked tile's paler lilac is there to
 * prevent), not the tile.
 */
export function pixelsOf(img: Rgba, hex: string): number {
  const rgb = hexRgb(hex);
  const isTile = tileMask(img);
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) if (!isTile[i] && near(img.data, i, rgb)) n++;
  return n;
}

/** The tile: every pixel of the corner pixel's colour that is joined to the screenshot's border through such pixels (not an ink-and-paper blend inside a shape that happens to match). */
function tileMask({ width, height, data }: Rgba): Uint8Array {
  const tile = [data[0], data[1], data[2]];
  const mask = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!mask[i] && near(data, i, tile)) {
      mask[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const [x, y] = [i % width, Math.floor(i / width)];
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  return mask;
}

/**
 * The flaws in a screenshot of a picture, drawn at `pxPerUnit` device pixels a unit, with `fills`
 * the picture's fill colours as hex (lime, lilac, paper; the picked tile's paler lilac).
 */
export function artFlaws(img: Rgba, pxPerUnit: number, fills: string[]): Flaw[] {
  const { width, height, data } = img;
  const n = width * height;
  const isTile = tileMask(img);
  const tileLab = lab(data[0], data[1], data[2]);
  const fillRgb = fills.map(hexRgb).filter((rgb) => Math.hypot(...lab(...rgb).map((v, i) => v - tileLab[i])) > SAME_AS_TILE);
  const light = new Float32Array(n);
  const isFill = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    light[i] = lab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])[0];
    if (fillRgb.some((f) => near(data, i, f))) isFill[i] = 1;
  }
  // A solid fill pixel: itself and its four neighbours are the fill, so an anti-aliased fringe pixel that happens to match does not count.
  const solid = (x: number, y: number) =>
    x > 0 && y > 0 && x < width - 1 && y < height - 1 && isFill[y * width + x] && isFill[y * width + x - 1] && isFill[y * width + x + 1] && isFill[(y - 1) * width + x] && isFill[(y + 1) * width + x];
  const flaws: Flaw[] = [];

  // Fill on tile: a solid fill pixel with a tile pixel within reach.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      for (let dy = -FILL_REACH; dy <= FILL_REACH; dy++) {
        for (let dx = -FILL_REACH; dx <= FILL_REACH; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !isTile[ny * width + nx]) continue;
          const o = (y * width + x) * 4;
          flaws.push({ kind: 'fill on tile', at: `${x},${y}`, detail: `fill rgb(${data[o]},${data[o + 1]},${data[o + 2]}) meets the tile at ${nx},${ny}` });
          dy = dx = FILL_REACH + 1;
        }
      }
    }
  }

  // Fragments: connected pieces (eight neighbours) of everything that is not the tile, smaller than a 1.5-unit square.
  const seen = new Uint8Array(n);
  const minArea = (FRAGMENT_UNITS * pxPerUnit) ** 2;
  for (let start = 0; start < n; start++) {
    if (isTile[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let area = 0;
    let [minX, minY, maxX, maxY] = [width, height, 0, 0];
    while (stack.length) {
      const i = stack.pop()!;
      area++;
      const [x, y] = [i % width, Math.floor(i / width)];
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (!isTile[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (area < minArea) flaws.push({ kind: 'fragment', at: `${minX},${minY}`, detail: `${area}px of picture on its own, ${maxX - minX + 1}x${maxY - minY + 1}px, clear of the rest` });
  }

  // Hairlines: along every row and every column, a bump or a dip in lightness narrower than 0.9 units at half its height, chained over 2 units of scanlines.
  if (pxPerUnit >= HAIRLINE_MIN_SCALE) {
    const maxWidth = Math.floor(WIDTH * pxPerUnit);
    const minLength = Math.ceil(LENGTH * pxPerUnit);
    for (const across of ['x', 'y'] as const) {
      const lines = across === 'x' ? height : width;
      const len = across === 'x' ? width : height;
      const at = (line: number, i: number) => (across === 'x' ? line * width + i : i * width + line);
      interface Run {
        a: number;
        b: number;
        sign: 1 | -1;
        from: number;
        count: number;
        step: number;
      }
      let open: Run[] = [];
      const close = (run: Run, line: number) => {
        if (run.count < minLength) return;
        const [x, y] = across === 'x' ? [run.a, run.from] : [run.from, run.a];
        const [x1, y1] = across === 'x' ? [run.a, line - 1] : [line - 1, run.a];
        flaws.push({
          kind: 'hairline',
          at: `${x},${y}`,
          detail: `a ${run.sign > 0 ? 'light' : 'dark'} line ${run.b - run.a + 1}px wide (under ${WIDTH} units) runs ${run.count}px ${across === 'x' ? 'down' : 'across'} to ${x1},${y1}, ${run.step.toFixed(0)} L* off its sides`,
        });
      };
      for (let line = 0; line < lines; line++) {
        const found: Run[] = [];
        for (const sign of [1, -1] as const) {
          const v = (i: number) => sign * light[at(line, i)];
          for (let m = 1; m < len - 1; m++) {
            if (v(m) < v(m - 1) || v(m) < v(m + 1)) continue;
            // A local peak: walk down each side to the valley floors; the bump stands on the higher one.
            let l = m;
            while (l > 0 && v(l - 1) <= v(l)) l--;
            let r = m;
            while (r < len - 1 && v(r + 1) <= v(r)) r++;
            const base = Math.max(v(l), v(r));
            const step = v(m) - base;
            if (step < STEP) continue;
            const half = base + step / 2;
            let a = m;
            while (a > l && v(a - 1) > half) a--;
            let b = m;
            while (b < r && v(b + 1) > half) b++;
            if (b - a + 1 > maxWidth) continue;
            if (!found.some((f) => f.sign === sign && f.a <= b && f.b >= a)) found.push({ a, b, sign, from: line, count: 1, step });
          }
        }
        const next: Run[] = [];
        for (const f of found) {
          const prev = open.find((o) => o.sign === f.sign && o.a <= f.b + 1 && o.b >= f.a - 1);
          if (prev) {
            open.splice(open.indexOf(prev), 1);
            next.push({ ...prev, a: f.a, b: f.b, count: prev.count + 1, step: Math.max(prev.step, f.step) });
          } else next.push(f);
        }
        for (const o of open) close(o, line);
        open = next;
      }
      for (const o of open) close(o, lines);
    }
  }
  return flaws;
}
