import { inflateSync } from 'node:zlib';

/**
 * Pixel checks on screenshots of a game tile's picture (art.spec.ts). The live games' pictures are
 * drawn in the soft shaded style (GameArt.tsx): a 120-unit canvas shown 64 to 72px square, so at
 * device pixel ratios 1 to 3 a unit is 0.53 to 1.8 pixels. Both checks work against the tile: the
 * pixel in the screenshot's corner, and every pixel that looks the same (under a just-noticeable
 * difference) joined to the screenshot's border through such pixels.
 * - fragment: a piece of the picture smaller than 3 units square on its own, clear of the rest (a
 *   fleck where a shape slipped off another, or a speck of anti-aliasing). The picture is wherever
 *   it differs from the tile on any of the tiles it is shot on, so a white shape on the light tile
 *   is still one piece.
 * - see-through: the tile showing through inside the picture. The same picture is shot on tiles of
 *   different colours (dark, light, picked lilac), and every pixel that is the picture on all of them
 *   must look the same on all of them, unless it lies within a few pixels of where the tile itself
 *   shows: an anti-aliased outline, or the tip of a wedge of tile where two outlines meet at a point
 *   or a rounded corner leaves a straight side. Two shapes that meet edge to edge each anti-alias
 *   their own edge, so up to a quarter of the tile shows through along the whole join: a seam,
 *   darker on the dark tile and lighter on the light one. A sliver of tile between two shapes that
 *   should touch shows the same way.
 * (The flat style's hairline and fill-on-tile checks went with it: a shaded picture has no outlines
 * for a fill to slip past, and at under 2 pixels a unit its deliberate fine lines, a pencil band's
 * grooves or a card's printed frame, are as narrow as any hairline.)
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
  kind: 'fragment' | 'see-through';
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

/** Two colours look the same under this CIE76 delta E: a just-noticeable difference. */
const SAME = 2.3;
/** A piece of the picture on its own smaller than this many units square is a fleck. */
const FRAGMENT_UNITS = 3;
/** How far into the picture, in device pixels from the nearest pixel of tile, the tile may still show: an anti-aliased edge, or the tip of a wedge of tile. */
const SEE_THROUGH_DEPTH = 6;

function deltaE(a: Rgba, i: number, b: Rgba, j: number): number {
  const p = lab(a.data[i * 4], a.data[i * 4 + 1], a.data[i * 4 + 2]);
  const q = lab(b.data[j * 4], b.data[j * 4 + 1], b.data[j * 4 + 2]);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The tile: every pixel that looks like the corner pixel and is joined to the screenshot's border through such pixels (not a pixel inside a shape that happens to match). */
export function tileMask(img: Rgba): Uint8Array {
  const { width, height } = img;
  const mask = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!mask[i] && deltaE(img, i, img, 0) < SAME) {
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

/** How much of the screenshot is the picture rather than the tile, 0 to 1. */
export function coverage(img: Rgba): number {
  const tile = tileMask(img);
  let n = 0;
  for (const t of tile) if (!t) n++;
  return n / tile.length;
}

/** The connected pieces (eight neighbours) of the pixels `on` marks, each with its size and box. */
function pieces(width: number, height: number, on: (i: number) => boolean): { area: number; minX: number; minY: number; maxX: number; maxY: number; pixels: number[] }[] {
  const seen = new Uint8Array(width * height);
  const found = [];
  for (let start = 0; start < width * height; start++) {
    if (!on(start) || seen[start]) continue;
    const stack = [start];
    const pixels: number[] = [];
    seen[start] = 1;
    let [minX, minY, maxX, maxY] = [width, height, 0, 0];
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const [x, y] = [i % width, Math.floor(i / width)];
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (on(j) && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    found.push({ area: pixels.length, minX, minY, maxX, maxY, pixels });
  }
  return found;
}

/**
 * The flecks in a picture drawn at `pxPerUnit` device pixels a unit: pieces of it smaller than 3
 * units square, clear of the rest. `shots` is the picture on tiles of different colours, and the
 * picture is wherever it differs from the tile on any of them: a white shape matches the light tile
 * and a dark one nearly matches the dark tile, so on one tile alone a detail inside such a shape
 * would look like a piece on its own.
 */
export function fragments(shots: Record<string, Rgba>, pxPerUnit: number): Flaw[] {
  const { width, height } = sameSize(shots);
  const masks = Object.values(shots).map(tileMask);
  const minArea = (FRAGMENT_UNITS * pxPerUnit) ** 2;
  return pieces(width, height, (i) => masks.some((m) => !m[i]))
    .filter((p) => p.area < minArea)
    .map((p) => ({ kind: 'fragment', at: `${p.minX},${p.minY}`, detail: `${p.area}px of picture on its own, ${p.maxX - p.minX + 1}x${p.maxY - p.minY + 1}px, clear of the rest` }));
}

/** The size the shots share (the same picture in the same box), or an error. */
function sameSize(shots: Record<string, Rgba>): { width: number; height: number } {
  const [first, ...rest] = Object.entries(shots);
  const { width, height } = first[1];
  for (const [name, img] of rest) if (img.width !== width || img.height !== height) throw new Error(`${name}: ${img.width}x${img.height}, not ${width}x${height} like ${first[0]}`);
  return { width, height };
}

/**
 * Where the tile shows through inside a picture: `shots` is the same picture on tiles of different
 * colours, keyed by the tile. A pixel that is the picture on every tile and more than 6 pixels from
 * the nearest pixel of tile on any of them has to look the same on all of them.
 */
export function seeThrough(shots: Record<string, Rgba>): Flaw[] {
  const names = Object.keys(shots);
  const [first] = names;
  const { width, height } = sameSize(shots);
  // How far each pixel is from the nearest pixel of tile on any of the shots (eight neighbours, in pixels).
  const depth = new Int32Array(width * height).fill(-1);
  let ring: number[] = [];
  const masks = names.map((name) => tileMask(shots[name]));
  for (let i = 0; i < width * height; i++) {
    if (masks.some((m) => m[i])) {
      depth[i] = 0;
      ring.push(i);
    }
  }
  for (let d = 1; ring.length; d++) {
    const next: number[] = [];
    for (const i of ring) {
      const [x, y] = [i % width, Math.floor(i / width)];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (depth[j] < 0) {
            depth[j] = d;
            next.push(j);
          }
        }
      }
    }
    ring = next;
  }
  // The pixel at depth -1 has no tile anywhere near it (a screenshot with no tile at all): count it as deep.
  const differs = (i: number) => (depth[i] < 0 || depth[i] > SEE_THROUGH_DEPTH) && names.some((name) => deltaE(shots[name], i, shots[first], i) >= SAME);
  return pieces(width, height, differs).map((p) => {
    const worst = p.pixels.reduce((w, i) => Math.max(w, ...names.map((name) => deltaE(shots[name], i, shots[first], i))), 0);
    const deepest = p.pixels.reduce((w, i) => Math.max(w, depth[i]), 0);
    return {
      kind: 'see-through',
      at: `${p.minX},${p.minY}`,
      detail: `${p.area}px across ${p.maxX - p.minX + 1}x${p.maxY - p.minY + 1}px look different on different tiles (delta E up to ${worst.toFixed(0)}), up to ${deepest}px inside the picture`,
    };
  });
}
