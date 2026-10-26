/**
 * How the other players' tiles fill the space the table leaves them: the tier (how much each tile
 * shows) goes by the room the seats have, and the columns by the space the grid has. Past what a
 * grid holds with every tile whole, the seats are full tiles in a strip that scrolls sideways
 * (seatPlan), and the rest of the table stays put. Pure, for the grid component and the tests.
 */

/**
 * - `full`: the cards-first tile. A header (avatar, name, status pill), the hand as a fan of
 *   readable cards with a big total beside it, and a footer (the stack, the bet).
 * - `compact`: the same skeleton with the total alone where the cards were.
 * - `small`: avatar with a status dot, total, the name shortened; the stack and the bet too where
 *   the tile is tall enough (a desktop).
 * - `dense`: an avatar chip with a total badge and a status dot.
 */
export type TileTier = 'full' | 'compact' | 'small' | 'dense';

/** Richest first. */
export const TIERS: readonly TileTier[] = ['full', 'compact', 'small', 'dense'];

/** The tier a table of `count` others usually takes: full to 7, compact to 9, small to 23, dense beyond (the room decides, tierFor). */
export function tileTier(count: number): TileTier {
  if (count <= 7) return 'full';
  if (count <= 9) return 'compact';
  if (count <= 23) return 'small';
  return 'dense';
}

export interface TierShape {
  /** The tile at its natural size, in px; it never grows past it. */
  width: number;
  height: number;
  /** The shortest the tile still reads: its rows give up this much before the tier steps down. */
  minHeight: number;
  /** The column counts the tier reads best at. */
  cols: readonly [number, number];
  /** The most columns the tier may spread to when the grid is short. */
  maxCols: number;
  /**
   * The narrowest the tile still reads (its name, its total, the Playing tag, a full tile's stack in
   * words): a grid has no more columns than fit at this width (tiles that would need more take
   * another row, or a poorer tier where the rows have no room), and a short grid never spreads
   * past them, the tiles get shorter instead.
   */
  minWidth: number;
  /** Narrower than `below` px, the tile puts its stack over its bet: `extra` px taller (table.css). */
  narrow?: { below: number; extra: number };
}

/**
 * A phone's tiles: never under 140px wide, so two across every phone (the header's name and
 * status pill side by side, the fan at its 24px floor beside the total). A full tile's least
 * height drops its footer (the stack and the bet), tightens its padding and keeps the cards at
 * their floor (table.css: 70px).
 */
export const TIER_SHAPES: Record<TileTier, TierShape> = {
  full: { width: 160, height: 77, minHeight: 68, cols: [1, 4], maxCols: 4, minWidth: 150 },
  compact: { width: 120, height: 85, minHeight: 79, cols: [2, 3], maxCols: 4, minWidth: 92, narrow: { below: 100, extra: 15 } },
  small: { width: 70, height: 50, minHeight: 36, cols: [4, 6], maxCols: 10, minWidth: 44 },
  dense: { width: 46, height: 30, minHeight: 26, cols: [6, 8], maxCols: 14, minWidth: 24 },
};

/** A desktop's: up to five across a row (capped at 320px wide, table.css), the cards 32px to 40px. */
export const WIDE_TIER_SHAPES: Record<TileTier, TierShape> = {
  full: { width: 210, height: 101, minHeight: 89, cols: [1, 6], maxCols: 8, minWidth: 170 },
  compact: { width: 130, height: 105, minHeight: 99, cols: [3, 6], maxCols: 10, minWidth: 116 },
  small: { width: 84, height: 84, minHeight: 40, cols: [4, 8], maxCols: 9, minWidth: 64 },
  dense: { width: 52, height: 34, minHeight: 28, cols: [6, 10], maxCols: 12, minWidth: 48 },
};

/** The gap between tiles, in px (table.css reads it from the grid). */
export const GRID_GAP: Record<TileTier, number> = { full: 5, compact: 5, small: 4, dense: 4 };

/** The narrowest a seat's card is drawn, in px. */
export const CARD_FLOOR = { phone: 24, wide: 32 } as const;

/** How far each card of a fan steps right, in card widths (table.css --fan-step), and the least it may step: the rank and suit of a "10" still in view. */
export const FAN_STEP = 0.44;
export const FAN_STEP_LEAST = 0.3;

/**
 * The step a fan of `cards` takes in a box `width` px wide with its cards at the `floor`: the
 * usual step where the fan fits, a closer one where it would not (a long hand on a narrow tile),
 * never closer than FAN_STEP_LEAST. In hundredths, so a box a hair wider never moves the cards.
 */
export function fanStep(width: number, cards: number, floor: number): number {
  const n = Math.max(2, cards);
  if (width <= 0 || floor * (1 + FAN_STEP * (n - 1)) <= width) return FAN_STEP;
  const step = Math.floor(((width / floor - 1) / (n - 1)) * 100) / 100;
  return Math.max(FAN_STEP_LEAST, Math.min(FAN_STEP, step));
}

/** The widest a tile is drawn (table.css caps its column at the same). */
export const TILE_MAX_WIDTH = 320;

export interface GridOptions {
  wide?: boolean;
  tier?: TileTier;
}

/**
 * A full tile before the deal (no seat has cards): its words alone, so an empty table never shows
 * tall empty boxes. The avatar's row, the 5px under it (clear of the avatar's badge) and the stake
 * pill's line (a wide tile's side layout, table.css) take 54.3px, the tile's padding and border 13px.
 */
export const BARE_FULL_HEIGHT = 50;
export const WIDE_BARE_FULL_HEIGHT = 58;

/** A compact tile before the deal: its header, then its stack over its bet (table.css), however narrow. */
export const BARE_COMPACT_HEIGHT = 57;
export const WIDE_BARE_COMPACT_HEIGHT = 66;

/** How much taller a tile `tileWidth` px wide is for its narrow layout (TierShape.narrow): 0 where it has the width. */
export function narrowExtra(shape: TierShape, tileWidth: number | null): number {
  return shape.narrow && tileWidth !== null && tileWidth < shape.narrow.below ? shape.narrow.extra : 0;
}

/** The height a tile takes: its tier's, or a full tile's bare height while no seat has cards; taller where it is narrow (`tileWidth`). */
export function tileHeight(tier: TileTier, wide: boolean, bare: boolean, tileWidth: number | null = null): number {
  if (bare && tier === 'full') return wide ? WIDE_BARE_FULL_HEIGHT : BARE_FULL_HEIGHT;
  if (bare && tier === 'compact') return wide ? WIDE_BARE_COMPACT_HEIGHT : BARE_COMPACT_HEIGHT;
  return shapeOf(tier, wide).height + narrowExtra(shapeOf(tier, wide), tileWidth);
}

/** The width of each of `cols` columns `gap` apart in a row `width` wide. */
export function columnWidth(width: number, cols: number, gap: number): number {
  return (width - (cols - 1) * gap) / cols;
}

export function shapeOf(tier: TileTier, wide: boolean): TierShape {
  return (wide ? WIDE_TIER_SHAPES : TIER_SHAPES)[tier];
}

/** The gap between rows: the tiles' own gap (a desktop row is flat, no arc). */
export function rowGapOf(tier: TileTier, _wide: boolean): number {
  return GRID_GAP[tier];
}

export function paddingOf(_tier: TileTier, _wide: boolean): number {
  return 0;
}

export interface GridFit {
  cols: number;
  rows: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The columns before the grid has been measured (and on the server render): the tier's usual shape. */
export function defaultColumns(count: number, tier: TileTier = tileTier(count)): number {
  if (count <= 0) return 1;
  switch (tier) {
    case 'full':
      return clamp(count, 1, 5);
    case 'compact':
      // Three or fewer in one row; more, two columns (a phone) or two rows (a desktop's columns go by its shape).
      return count <= 3 ? count : clamp(Math.ceil(count / 2), 2, 5);
    case 'small':
      return clamp(Math.ceil(count / 3), 4, 6);
    case 'dense':
      return clamp(Math.ceil(count / 6), 6, 8);
  }
}

/** How large a tile can be with `cols` columns in a `width` x `height` box: 1 is its natural size (never more). */
export function tileScale(count: number, cols: number, box: { width: number; height: number }, shape: TierShape, gap: number, rowGap: number = gap): number {
  const rows = Math.ceil(count / cols);
  const w = columnWidth(box.width, cols, gap);
  const h = (box.height - (rows - 1) * rowGap) / rows;
  return Math.min(1, w / shape.width, h / (shape.height + narrowExtra(shape, w)));
}

/** The most columns whose tiles are still wide enough to read (always at least one). */
function widestColumns(shape: TierShape, width: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (shape.minWidth + gap)));
}

/**
 * The columns that give the largest tiles in the box, among those whose rows keep the tile's
 * least height; on a tie (tiles already at their natural size) the tier's usual shape. Searched
 * over the tier's usual range first; a short box may spread further, up to the tier's limit, when
 * that makes the tiles clearly larger or is the only way to keep their height, but never to
 * columns narrower than the tier's minimum width (a narrow tile clips its name and total).
 */
export function fitGrid(count: number, box: { width: number; height: number } | null, { wide = false, tier = tileTier(count), gap = GRID_GAP[tier], rowGap = rowGapOf(tier, wide) }: GridOptions & { gap?: number; rowGap?: number } = {}): GridFit {
  const n = Math.max(1, count);
  const shape = shapeOf(tier, wide);
  const usualCols = Math.min(n, defaultColumns(count, tier));
  if (!box || box.width <= 0 || box.height <= 0) return { cols: usualCols, rows: Math.ceil(n / usualCols) };
  const tall = (cols: number): boolean => {
    const rows = Math.ceil(n / cols);
    return (box.height - (rows - 1) * rowGap) / rows >= shape.minHeight + narrowExtra(shape, columnWidth(box.width, cols, gap));
  };
  const best = (lo: number, hi: number): { cols: number; scale: number; tall: boolean } => {
    let pick = { cols: usualCols, scale: -1, tall: false };
    for (let c = Math.min(n, lo); c <= Math.min(n, hi); c++) {
      const scale = tileScale(n, c, box, shape, gap, rowGap);
      const keeps = tall(c);
      const larger = scale > pick.scale + 1e-6 || (Math.abs(scale - pick.scale) <= 1e-6 && Math.abs(c - usualCols) < Math.abs(pick.cols - usualCols));
      if ((keeps && !pick.tall) || (keeps === pick.tall && larger)) pick = { cols: c, scale, tall: keeps };
    }
    return pick;
  };
  const widest = widestColumns(shape, box.width, gap);
  const usual = best(Math.min(shape.cols[0], usualCols, widest), Math.min(shape.cols[1], widest));
  if (usual.scale >= 1) return { cols: usual.cols, rows: Math.ceil(n / usual.cols) };
  const spread = best(1, Math.min(shape.maxCols, widest));
  const pick = (spread.tall && !usual.tall) || (spread.tall === usual.tall && spread.scale > usual.scale + 0.02) ? spread : usual;
  return { cols: pick.cols, rows: Math.ceil(n / pick.cols) };
}

/**
 * The height the grid takes with its tiles at their natural size in a row `width` px wide, in the
 * tier's usual columns (as many as fit at the tier's least width), its row gap and padding
 * included: the most a table gives its seats, so a few tiles never take a tall band with empty
 * space round them. It goes by the width alone, never by the height the grid was given. Before
 * the deal (`bare`) the full tiles keep to their top rows.
 */
export function naturalHeight(count: number, width: number, { wide = false, tier = tileTier(count), bare = false }: GridOptions & { bare?: boolean } = {}): number {
  if (count <= 0) return 0;
  const shape = shapeOf(tier, wide);
  const cols = Math.min(count, defaultColumns(count, tier), widestColumns(shape, width, GRID_GAP[tier]));
  const rows = Math.ceil(count / cols);
  return rows * tileHeight(tier, wide, bare, columnWidth(width, cols, GRID_GAP[tier])) + (rows - 1) * rowGapOf(tier, wide) + paddingOf(tier, wide);
}

/**
 * The least height a tier's grid takes for `count` tiles in a row `width` wide: its fewest rows
 * (as many columns as fit at the tile's least width, up to the tier's most) at the tile's least
 * height, with the gaps and the arc's padding.
 */
export function leastHeight(count: number, width: number, { wide = false, tier = tileTier(count) }: GridOptions = {}): number {
  if (count <= 0) return 0;
  const shape = shapeOf(tier, wide);
  const cols = Math.max(1, Math.min(count, shape.maxCols, widestColumns(shape, width, GRID_GAP[tier])));
  const rows = Math.ceil(count / cols);
  return rows * (shape.minHeight + narrowExtra(shape, columnWidth(width, cols, GRID_GAP[tier]))) + (rows - 1) * rowGapOf(tier, wide) + paddingOf(tier, wide);
}

/** The room the seats have: the width of their row, and the height the table's other rows leave. */
export interface Room {
  width: number;
  height: number;
}

/** Whether a tier's grid for `count` tiles has the room: its least height fits. */
export function fitsRoom(count: number, room: Room, { wide = false, tier = tileTier(count) }: GridOptions = {}): boolean {
  return leastHeight(count, room.width, { wide, tier }) <= room.height;
}

/** A richer tier takes over only with this much to spare, so a room that wobbles by a pixel never flips the tiles. */
export const SPARE = 8;

/** The poorest tier a count may fall to when its usual one has no room: full gives up its cards for compact; the rest keep what they show (the stack and the bet stay on a compact tile). */
const LOWEST: Record<TileTier, TileTier> = { full: 'small', compact: 'small', small: 'small', dense: 'dense' };

/**
 * How the seats are laid out: the tier of their tiles, and whether they are a grid that holds
 * them all (`strip` false) or a strip of full tiles that scrolls sideways, as many rows of them as
 * the room holds (PlayersGrid; table.css .tbl-strip).
 */
export interface SeatPlan {
  tier: TileTier;
  strip: boolean;
}

/** The plans a table may take, richest first: a grid of full tiles, of compact ones, the strip of full tiles, the crowd's chips. */
const PLANS: readonly SeatPlan[] = [
  { tier: 'full', strip: false },
  { tier: 'compact', strip: false },
  { tier: 'full', strip: true },
  { tier: 'small', strip: false },
  { tier: 'dense', strip: false },
];

const rankOf = (plan: SeatPlan): number => PLANS.findIndex((p) => p.tier === plan.tier && p.strip === plan.strip);

/**
 * The plan the room allows: the richest, down to the count's own tier or one step under it, whose
 * least height fits the room. A grid while every tile in it keeps its cards, its bet and its stack
 * at their floors (full tiles, then compact ones: seven seats across a desktop, three on an SE);
 * past that, the strip, whose least height is one row of full tiles, so every seat still shows
 * everything at any count; the crowd's chips only where not even that row fits. When nothing
 * fits, the poorest of those, overflowing a little: a full tile squashed under its least height
 * would cut its cards off at its bottom edge. Before the room is measured, and on the server
 * render, the count's usual tier in a grid. The plan on show stays while it still fits: a richer
 * one takes over only with SPARE to spare.
 */
export function seatPlan(count: number, room: Room | null, { wide = false, current = null }: { wide?: boolean; current?: SeatPlan | null } = {}): SeatPlan {
  const usual = tileTier(count);
  const lowest: SeatPlan = { tier: LOWEST[usual], strip: false };
  if (room === null || count <= 0) return { tier: usual, strip: false };
  const now = current === null ? -1 : rankOf(current);
  for (const plan of PLANS.slice(0, rankOf(lowest) + 1)) {
    const least = plan.strip ? stripLeast(1, wide) : leastHeight(count, room.width, { wide, tier: plan.tier });
    if (least + (now >= 0 && rankOf(plan) < now ? SPARE : 0) <= room.height) return plan;
  }
  return lowest;
}

/** The tier of the seats' tiles the room allows (seatPlan): a strip's are full. */
export function tierFor(count: number, room: Room | null, { wide = false, current = null }: { wide?: boolean; current?: TileTier | null } = {}): TileTier {
  return seatPlan(count, room, { wide, current: current === null ? null : { tier: current, strip: false } }).tier;
}

/** The height of `rows` rows of a strip's full tiles at their least, with the gaps between them. */
export function stripLeast(rows: number, wide = false): number {
  return rows * shapeOf('full', wide).minHeight + (rows - 1) * rowGapOf('full', wide);
}

/** The height of `rows` rows of a strip's full tiles at their natural size (before the deal, their bare height), with the gaps. */
export function stripHeight(rows: number, wide = false, bare = false): number {
  return rows * tileHeight('full', wide, bare) + (rows - 1) * rowGapOf('full', wide);
}

/**
 * The rows of a strip `height` px tall: as many as hold full tiles at their least height, at least
 * one and never more than there are seats. The rows on show (`current`) stay while they fit: one
 * more needs SPARE to spare.
 */
export function stripRows(count: number, height: number, wide = false, current: number | null = null): number {
  const most = (h: number): number => Math.max(1, Math.min(Math.max(1, count), Math.floor((h + rowGapOf('full', wide)) / (shapeOf('full', wide).minHeight + rowGapOf('full', wide)))));
  const rows = most(height);
  return current !== null && rows > current ? Math.max(current, most(height - SPARE)) : rows;
}

/**
 * Each end of a strip, in px: what shows there of the seat past the last whole one (under the
 * fade), and where the hint that more seats wait sits. The whole tiles keep between the two ends
 * wherever the strip stops (it snaps a tile to the left end); the ends are narrower only where
 * the full width would leave a phone a single tile across.
 */
export const STRIP_EDGE = { most: 24, least: 12 } as const;

export interface StripFit {
  rows: number;
  /** Columns of tiles in all (the seats run down each column, then on to the next). */
  cols: number;
  /** Columns whole in view between the strip's two ends. */
  view: number;
  /** A tile's width, in px. */
  tile: number;
  /** Each end's width, in px (STRIP_EDGE). */
  edge: number;
}

/**
 * A strip `width` px wide (it runs out over the felt's padding to the table's edges) of `count`
 * full tiles in `rows` rows: as many columns whole in view as fit at the tile's least width
 * between the ends, the tiles sharing the rest, never past TILE_MAX_WIDTH.
 */
export function fitStrip(count: number, width: number, rows: number, wide = false): StripFit {
  const shape = shapeOf('full', wide);
  const gap = GRID_GAP.full;
  const view = Math.max(1, Math.floor((width - 2 * STRIP_EDGE.least + gap) / (shape.minWidth + gap)));
  const edge = clamp((width - view * shape.minWidth - (view - 1) * gap) / 2, STRIP_EDGE.least, STRIP_EDGE.most);
  const tile = Math.min(TILE_MAX_WIDTH, (width - 2 * edge - (view - 1) * gap) / view);
  return { rows, cols: Math.ceil(Math.max(1, count) / rows), view, tile, edge };
}

/**
 * How much taller the ribbon over the seats may grow within a round than it was when the table
 * last read its room (useSeatRoom): the line saying whose turn it is wrapping a long name onto a
 * second line (a 19px line on a phone and the 2px between), and in Poker the turn clock (26px on a
 * phone) standing again where a 19px line of words stood.
 */
export const TURN_WRAP = 21;
export const TURN_CLOCK = 7;

/**
 * The height the seats keep out of `room` (their room with the cards at their least size) when a
 * phone's cards grow into the rest: the tiles' natural height in the tier the room gives them,
 * with SPARE over it, and never less than that tier's least height with `growth` over it (what the
 * ribbon may still take in the round), so the tiles keep their tier and their size whatever the
 * line under the ribbon says. With nobody else at the table, `growth` alone: the ribbon's own row
 * may still need it. Never more than the room.
 */
export function seatsNeed(count: number, room: Room, { wide = false, growth = 0 }: { wide?: boolean; growth?: number } = {}): number {
  if (count <= 0) return Math.min(room.height, growth);
  // Full tiles only where their least height still fits once the line under the ribbon has grown (and past the few pixels a
  // grid showing total-only tiles wants to spare before it takes them): planned otherwise, the seats kept the room for
  // cards the grid never showed. The strip and the crowd tiers go by the room as it is.
  const plain = seatPlan(count, room, { wide });
  const guarded = plain.tier === 'full' && !plain.strip ? seatPlan(count, { width: room.width, height: room.height - growth }, { wide }) : plain;
  // Never planned down to the strip or the crowd's chips for it: a grid's tile shows its cards, bet and stack wherever its least height fits.
  const plan = !guarded.strip && (guarded.tier === 'full' || guarded.tier === 'compact') ? guarded : plain;
  if (plan.strip) {
    // A strip's rows: as many as keep their least height once the line under the ribbon has grown, so they hold through the round.
    const rows = stripRows(count, room.height - growth, wide);
    return Math.min(room.height, Math.max(stripHeight(rows, wide) + SPARE, stripLeast(rows, wide) + growth));
  }
  const natural = naturalHeight(count, room.width, { wide, tier: plan.tier }) + SPARE;
  const least = leastHeight(count, room.width, { wide, tier: plan.tier }) + growth;
  return Math.min(room.height, Math.max(natural, least));
}

/** What the seats leave the cards of `room`, in whole pixels (seatsNeed): 0 where they need it all. */
export function seatsSpare(count: number, room: Room, options: { wide?: boolean; growth?: number } = {}): number {
  return Math.max(0, Math.floor(room.height - seatsNeed(count, room, options)));
}
