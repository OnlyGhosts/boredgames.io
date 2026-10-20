/**
 * The card-table pieces Blackjack and Poker share: the animation queue (planning from a previous
 * timeline, the discards before a new table, the backlog snap, shown numbers stepping to the
 * truth, departures, marks, flights), the desktop shortcuts, and the components (the panel shell,
 * the amount field, the moves, the players grid and its tiles, the line under the ribbon, the stage, the deck, the ribbon, the outcome pieces, a hand's
 * stepped fan, the stack and stake labels, a card turning over, the chips in the air and the screen shell). Runs in node
 * through react-dom/server.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';
import type { Draft, Timeline } from './timeline';

installBrowserGlobals();

const T = await import('./timeline');
const { hotkeyOf, typingIn } = await import('../lib/hotkeys');
const { AmountField } = await import('./AmountField');
const { MoveButton, PanelLabelRow, PanelMoves, PanelShell, TableButton, WatchingPanel, releaseClickedButton } = await import('./ControlPanel');
const { WATCHING_TEXT, isWatching } = await import('../lib/watching');
const { PlayerTile, PlayersGrid } = await import('./PlayersGrid');
const { TurnLine } = await import('./TurnLine');
const { TableStage } = await import('./TableStage');
const G = await import('./grid');
const R = await import('./room');
const { Deck, DiscardCorner } = await import('./Deck');
const { HandFan, OutcomeFlag } = await import('./HandFan');
const { StackCount, StakePill } = await import('./Stakes');
const S = await import('./stakes');
const { TableRibbon } = await import('./Ribbon');
const { PayoutFloat, TotalPill, outlineClass } = await import('./Outcome');
const { TableCard } = await import('./TableCard');
const { ChipFlights } = await import('./ChipFlights');

const NOW = 1_000_000;
const html = (el: ReactElement): string => renderToString(el);
const noop = () => undefined;

interface Toy {
  id: number;
}

describe('the animation queue', () => {
  const input = (over: Partial<Parameters<typeof T.beginPlan<Toy>>[0]> = {}) => ({ prev: T.emptyTimeline<Toy>(), prevTable: null, prevId: null, nextId: 1, now: NOW, fresh: false, motion: true, ...over });

  it('snaps on a fresh entry and under reduced motion, and starts a first table at once', () => {
    expect(T.beginPlan<Toy>(input({ fresh: true }))).toBeNull();
    expect(T.beginPlan<Toy>(input({ motion: false }))).toBeNull();
    const draft = T.beginPlan<Toy>(input());
    expect(draft).toMatchObject({ same: false, start: NOW });
    expect(draft?.tl.id).toBe(1);
  });

  it('carries on the same table after what is still landing, and keeps the previous timeline when nothing was added', () => {
    const prev: Timeline<Toy> = { ...T.snapTimeline<Toy>(1, NOW), arrivals: { a: NOW }, endsAt: NOW + 400 };
    const draft = T.beginPlan<Toy>(input({ prev, prevTable: { id: 1 }, prevId: 1, nextId: 1, now: NOW + 100 }));
    if (!draft) throw new Error('no draft');
    expect(draft).toMatchObject({ same: true, start: NOW + 400 });
    expect(draft.tl.arrivals).toEqual({ a: NOW });
    expect(T.finishPlan(draft, NOW + 400, false)).toBe(prev);
    draft.tl.arrivals.b = NOW + 400;
    expect(T.finishPlan(draft, NOW + 650, true)).toMatchObject({ endsAt: NOW + 650, arrivals: { a: NOW, b: NOW + 400 } });
    // The previous plan's maps are copies: planning on never touches the old timeline.
    expect(prev.arrivals).toEqual({ a: NOW });
  });

  it('clears the old table to the discards once its outcomes have had their moment, and snaps a backlog too long to play', () => {
    const prev: Timeline<Toy> = { ...T.snapTimeline<Toy>(1, NOW), marks: { [T.OUTCOMES]: NOW + 200 }, endsAt: NOW + 200 };
    const draft = T.beginPlan<Toy>(input({ prev, prevTable: { id: 1 }, prevId: 1, nextId: 2, now: NOW + 300 }));
    expect(draft?.tl.discard).toMatchObject({ table: { id: 1 }, from: NOW + 200 + T.OUTCOME_HOLD_MS, until: NOW + 200 + T.OUTCOME_HOLD_MS + T.DISCARD_MS });
    expect(draft?.start).toBe(NOW + 200 + T.OUTCOME_HOLD_MS + T.DISCARD_MS);
    expect(T.beginPlan<Toy>(input({ prev, prevTable: { id: 1 }, prevId: 1, nextId: 2, now: NOW + 300, hold: 0 }))?.start).toBe(NOW + 300 + T.DISCARD_MS);
    const late = { ...prev, endsAt: NOW + T.MAX_BACKLOG_MS + 500 };
    expect(T.beginPlan<Toy>(input({ prev: late, prevTable: { id: 1 }, prevId: 1, nextId: 1, now: NOW }))).toBeNull();
    const tl = T.finishPlan(draft as Draft<Toy>, 0, true);
    expect(T.frameAt(tl, { id: 2 }, NOW + 300)).toMatchObject({ table: { id: 1 }, leaving: false });
    expect(T.frameAt(tl, { id: 2 }, NOW + 200 + T.OUTCOME_HOLD_MS)).toMatchObject({ table: { id: 1 }, leaving: true });
    expect(T.frameAt(tl, { id: 2 }, NOW + 200 + T.OUTCOME_HOLD_MS + T.DISCARD_MS)).toMatchObject({ table: { id: 2 }, leaving: false });
  });

  it('answers where every card is and which numbers show at any moment', () => {
    const tl = T.snapTimeline<Toy>(1, NOW);
    tl.arrivals.a = NOW;
    tl.moved.m = true;
    tl.arrivals.m = NOW;
    tl.flips.a = NOW + 500;
    tl.departures.d = NOW + 100;
    tl.marks.done = NOW + 800;
    tl.flights.push({ id: 'f', from: 'seat:x', to: 'pot', amount: 40, at: NOW + 200, ms: 300 });
    T.tween(tl, 'pot', 10, NOW + 500, 50);
    T.tween(tl, 'pot', 99, NOW + 900, 0);
    tl.endsAt = NOW + 900;
    expect(T.cardShown(tl, 'a', NOW - 1)).toBe(false);
    expect(T.cardShown(tl, 'never-planned', NOW - 1)).toBe(true);
    expect(T.cardMotion(tl, 'a', NOW + 10)).toBe('deal');
    expect(T.cardMotion(tl, 'm', NOW + 10)).toBe('move');
    expect(T.cardMotion(tl, 'a', NOW + T.DEAL_MS)).toBeNull();
    // A card counts towards a total once it lands: a deal after DEAL_MS, a move after MOVE_MS.
    expect(T.landed(tl, 'a', NOW + T.DEAL_MS - 1)).toBe(false);
    expect(T.landed(tl, 'a', NOW + T.DEAL_MS)).toBe(true);
    expect(T.landed(tl, 'm', NOW + T.MOVE_MS)).toBe(true);
    expect(T.landed(tl, 'never-planned', NOW - 1)).toBe(true);
    expect(T.faceDown(tl, 'a', NOW + 499)).toBe(true);
    expect(T.flipping(tl, 'a', NOW + 500)).toBe(true);
    expect(T.flipping(tl, 'a', NOW + 500 + T.FLIP_MS)).toBe(false);
    expect(T.departure(tl, 'd', NOW)).toBe('here');
    expect(T.departure(tl, 'd', NOW + 100)).toBe('leaving');
    expect(T.departure(tl, 'd', NOW + 100 + T.DISCARD_MS)).toBe('gone');
    expect(T.departure(tl, 'other', NOW)).toBe('gone');
    expect(T.reached(tl, 'done', NOW + 799)).toBe(false);
    expect(T.reached(tl, 'unplanned', NOW)).toBe(true);
    expect(T.flightsAt(tl, NOW + 199)).toEqual([]);
    expect(T.flightsAt(tl, NOW + 200).map((f) => f.id)).toEqual(['f']);
    expect(T.flightsAt(tl, NOW + 500)).toEqual([]);
    expect(T.valueAt(tl, 'pot', 0, NOW)).toBe(10);
    expect(T.valueAt(tl, 'pot', 0, NOW + 500)).toBe(50);
    expect(T.valueAt(tl, 'pot', 0, NOW + 900)).toBe(0);
    expect(T.valueAt(tl, 'unplanned', 7, NOW)).toBe(7);
    expect(T.animating(tl, NOW + 899)).toBe(true);
    expect(T.nextEvent(tl, NOW + 10)).toBe(NOW + 100);
    expect(T.nextEvent(tl, NOW + 900)).toBeNull();
  });
});

describe('a dealt card', () => {
  it('starts on the deck at the deck’s size and upright, so its flight never leaves the table', async () => {
    const { deckStart } = await import('./TableCard');
    // A 132px card dealt to the middle from a 72px deck in the table's top right corner.
    const card = { left: 600, top: 120, width: 132, height: 198 };
    const deck = { left: 1254, top: 114, width: 72, height: 108 };
    expect(deckStart(card, deck)).toBe(`translate(${1290 - 666}px, ${168 - 219}px) scale(${72 / 132})`);
    expect(deckStart(card, deck)).not.toContain('rotate');
    // A card smaller than the deck (a phone's mini cards) is never blown up.
    expect(deckStart({ left: 0, top: 0, width: 30, height: 45 }, deck)).toMatch(/scale\(1\)$/);
  });
});

describe('the players grid', () => {
  it('steps the tiles down in tiers as the table grows: full to 4 others, compact to 9, small to 23, dense beyond', () => {
    const tiers = [1, 4, 5, 9, 10, 23, 24, 49].map((n) => G.tileTier(n));
    expect(tiers).toEqual(['full', 'full', 'compact', 'compact', 'small', 'small', 'dense', 'dense']);
  });

  it('picks the tier from the room the seats have: the richest whose fewest rows keep the tiles’ least height', () => {
    // Three others on a phone: full at 390x844 (a 141px room) and 360x740 (111px), compact on a 320x568 (79px), where the full tile (94px) has no room.
    expect(G.tierFor(3, { width: 356, height: 141 })).toBe('full');
    expect(G.tierFor(3, { width: 326, height: 111 })).toBe('full');
    expect(G.tierFor(3, { width: 290, height: 79 })).toBe('compact');
    expect(G.fitsRoom(3, { width: 290, height: 79 }, { tier: 'compact' })).toBe(true);
    // Four others at 390: two rows of full tiles never fit, one row of compact ones does.
    expect(G.tierFor(4, { width: 356, height: 141 })).toBe('compact');
    // Five others on a 320x568 phone: two rows of compact tiles have no room, but a compact tile is the least a seat shows (its stack and bet): it stays, overflowing a little, never small.
    expect(G.tierFor(5, { width: 290, height: 79 })).toBe('compact');
    expect(G.fitsRoom(5, { width: 290, height: 79 }, { tier: 'compact' })).toBe(false);
    // A 1440x900 desktop with five, seven or eight others: one row of full tiles (the cards in play stay in the seat) up to seven across.
    expect(G.tierFor(5, { width: 898, height: 191 }, { wide: true })).toBe('full');
    expect(G.tierFor(7, { width: 898, height: 191 }, { wide: true })).toBe('full');
    expect(G.tierFor(8, { width: 898, height: 191 }, { wide: true })).toBe('compact');
    expect(G.tierFor(11, { width: 898, height: 191 }, { wide: true })).toBe('compact');
    expect(G.tierFor(23, { width: 898, height: 191 }, { wide: true })).toBe('small');
    // A 1280x800 desktop with eleven others: compact tiles would be narrower than their words, so small, as the count says.
    expect(G.tierFor(11, { width: 742, height: 140 }, { wide: true })).toBe('small');
    // Eleven or twenty-three others on a phone: small (a count's tier never falls below small for them, even where it overflows).
    expect(G.tierFor(11, { width: 356, height: 141 })).toBe('small');
    expect(G.tierFor(23, { width: 356, height: 141 })).toBe('small');
    expect(G.tierFor(49, { width: 290, height: 10 })).toBe('dense');
    // Unmeasured (the server render): the count's usual tier.
    expect(G.tierFor(6, null)).toBe('compact');
    expect(G.leastHeight(3, 356, { tier: 'full' })).toBe(94);
    expect(G.leastHeight(7, 898, { wide: true, tier: 'full' })).toBe(90 + 18);
  });

  it('never makes a phone’s full tile narrower than its stack in words: three across a 360px phone, two across a 320px one', () => {
    // A full tile writes the stack beside the face: "12,500 chips" needs 103px in the ring of the seat on turn.
    expect(G.TIER_SHAPES.full.minWidth).toBe(104);
    // A 360px phone's seats (326px across): three full tiles of 105px in a row.
    expect(G.fitGrid(3, { width: 326, height: 120 }, { tier: 'full' })).toEqual({ cols: 3, rows: 1 });
    expect(G.leastHeight(3, 326, { tier: 'full' })).toBe(94);
    // A 320px phone's (290px): three across were 93px and cut "1,250 chips" to "1,250 chip". Full tiles take two rows there,
    // which a phone that short never has room for: one row of compact tiles (their stack and bet), whatever the room left.
    expect(G.leastHeight(3, 290, { tier: 'full' })).toBe(2 * 94 + 6);
    expect(G.fitGrid(3, { width: 290, height: 200 }, { tier: 'full' })).toEqual({ cols: 2, rows: 2 });
    for (const height of [79, 120, 150, 190]) expect(G.tierFor(3, { width: 290, height }), `${height}px`).toBe('compact');
    for (const count of [1, 2]) expect(G.tierFor(count, { width: 290, height: 120 }), `${count} others`).toBe('full');
    // A 430px phone's (396px): never four across (95px), three.
    expect(G.fitGrid(4, { width: 396, height: 300 }, { tier: 'full' }).cols).toBeLessThanOrEqual(3);
    expect(G.fitGrid(11, { width: 396, height: 400 }, { tier: 'full' })).toEqual({ cols: 3, rows: 4 });
    // The cards' share goes by the same tiers: three others on a 320px phone keep a row of compact tiles (68px) and the 8px over it.
    expect(G.seatsNeed(3, { width: 290, height: 150 }, { growth: G.TURN_WRAP })).toBe(68 + G.SPARE);
  });

  it('keeps the tier on show while it still fits: a richer one needs a few pixels to spare, so a room that wobbles never flips the tiles', () => {
    const room = (height: number) => ({ width: 356, height });
    // Compact on show, the full tier fits by a hair: it stays compact until the room is clearly enough.
    expect(G.tierFor(3, room(96), { current: 'compact' })).toBe('compact');
    expect(G.tierFor(3, room(104), { current: 'compact' })).toBe('full');
    // Full on show keeps the room it has, down to its least height.
    expect(G.tierFor(3, room(96), { current: 'full' })).toBe('full');
    expect(G.tierFor(3, room(90), { current: 'full' })).toBe('compact');
  });

  it('spreads a row rather than squeeze the tiles under their least height: seven full tiles across a desktop, never two short rows', () => {
    expect(G.fitGrid(7, { width: 898, height: 173 }, { wide: true, tier: 'full' })).toEqual({ cols: 7, rows: 1 });
    expect(G.fitGrid(5, { width: 898, height: 173 }, { wide: true, tier: 'full' })).toEqual({ cols: 5, rows: 1 });
    // Room for two rows at the natural height: the usual shape.
    expect(G.fitGrid(5, { width: 898, height: 300 }, { wide: true, tier: 'full' })).toEqual({ cols: 4, rows: 2 });
  });

  it('starts from the tier’s usual columns before the grid is measured (and on the server render)', () => {
    expect([1, 2, 3, 4].map((n) => G.fitGrid(n, null).cols)).toEqual([1, 2, 3, 4]);
    // Compact: two rows. Small: 4 to 6 columns. Dense: 6 to 8.
    expect([5, 6, 7, 9].map((n) => G.fitGrid(n, null).cols)).toEqual([3, 3, 4, 5]);
    expect([10, 12, 13, 18, 23].map((n) => G.fitGrid(n, null).cols)).toEqual([4, 4, 5, 6, 6]);
    expect([24, 36, 42, 49].map((n) => G.fitGrid(n, null).cols)).toEqual([6, 6, 7, 8]);
    expect(G.fitGrid(49, null)).toEqual({ cols: 8, rows: 7 });
  });

  it('fits the columns to the space: tiles at their natural size keep the usual shape, a short grid spreads wider', () => {
    // Room to spare: the usual shape.
    expect(G.fitGrid(6, { width: 374, height: 200 })).toEqual({ cols: 3, rows: 2 });
    expect(G.fitGrid(12, { width: 374, height: 170 }, { gap: 4 })).toEqual({ cols: 4, rows: 3 });
    // Two others share one row however tall the grid is.
    expect(G.fitGrid(2, { width: 374, height: 400 }).cols).toBe(2);
    // A short grid: 49 small chips spread to more columns rather than shrink to nothing.
    const short = G.fitGrid(49, { width: 304, height: 90 }, { gap: 4 });
    expect(short.cols).toBeGreaterThan(8);
    expect(short.cols * short.rows).toBeGreaterThanOrEqual(49);
    expect(G.tileScale(49, short.cols, { width: 304, height: 90 }, G.TIER_SHAPES.dense, 4)).toBeGreaterThan(G.tileScale(49, 8, { width: 304, height: 90 }, G.TIER_SHAPES.dense, 4));
    // Every fit holds every tile.
    for (const n of [1, 3, 5, 8, 11, 17, 23, 24, 31, 49]) {
      const fit = G.fitGrid(n, { width: 340, height: 140 }, { gap: 4 });
      expect(fit.cols * fit.rows, `${n} tiles`).toBeGreaterThanOrEqual(n);
      expect((fit.cols - 1) * fit.rows, `${n} tiles, no empty row`).toBeLessThan(n + fit.rows);
    }
  });

  it('never spreads tiles narrower than they read: names, totals and the Playing tag stay whole', () => {
    // Six players on a 360x740 phone, a short grid: five 60px columns read "Har", "Pl"; now never under 64px.
    const fit = G.fitGrid(5, { width: 326, height: 57 });
    expect((326 - (fit.cols - 1) * 6) / fit.cols).toBeGreaterThanOrEqual(G.TIER_SHAPES.compact.minWidth);
    expect(fit.cols).toBeLessThanOrEqual(4);
    // Every tier, every box: the columns keep the tier's minimum width (one column at the least).
    for (const wide of [false, true]) {
      const shapes = wide ? G.WIDE_TIER_SHAPES : G.TIER_SHAPES;
      for (const n of [3, 5, 8, 12, 23, 30, 49])
        for (const box of [{ width: 290, height: 40 }, { width: 326, height: 57 }, { width: 356, height: 300 }, { width: 582, height: 90 }, { width: 742, height: 418 }]) {
          const { cols } = G.fitGrid(n, box, { wide, gap: 4 });
          const min = shapes[G.tileTier(n)].minWidth;
          if (cols > 1) expect((box.width - (cols - 1) * 4) / cols, `${n} tiles in ${box.width}x${box.height}${wide ? ' (desktop)' : ''}`).toBeGreaterThanOrEqual(min);
        }
    }
    // A 1280x800 desktop with 49 others: 13 columns of 41px used to leave the tiles 14px tall.
    expect(G.fitGrid(49, { width: 582, height: 318 }, { wide: true, gap: 8 }).cols).toBeLessThanOrEqual(G.WIDE_TIER_SHAPES.dense.maxCols);
    expect(G.WIDE_TIER_SHAPES.dense.maxCols).toBeLessThanOrEqual(12);
  });

  it('keeps a small tile’s total inside it on the narrowest phones: a badge on its corner, never cut to one digit', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@container tile (max-width: 56px)'));
    const block = narrow.slice(0, narrow.indexOf('\n}\n'));
    expect(block).toMatch(/\.tbl-tile--small \.tbl-tile__total \{\s*position: absolute;\s*top: 1px;\s*right: 1px;/);
    // The avatar shrinks with a short tile rather than overflow it.
    expect(css).toMatch(/\.tbl-tile--small \{\s*\/\*[^*]*\*\/\s*--face: min\(24px, max\(16px, calc\(100cqh - 19px\)\)\);/);
  });

  it('lifts the ends of a desktop row less as the tiles get smaller (the arc costs height)', () => {
    const grid = (n: number) => html(createElement(PlayersGrid, { count: n, label: 'Players', wide: true, children: () => [] }));
    expect(grid(3)).toContain('--arc:16px');
    expect(grid(12)).toContain('--arc:8px');
    expect(grid(30)).toContain('--arc:4px');
  });

  it('bows the desktop rows into a gentle arc: the middle lowest, the ends lifted', () => {
    expect([0, 1, 2, 3, 4].map((c) => G.arcLift(c, 5))).toEqual([1, 0.25, 0, 0.25, 1]);
    expect(G.arcLift(0, 1)).toBe(0);
  });
});

describe('the room a phone’s cards take', () => {
  // A 390x844 phone's seats: 356px across, 171px tall with the cards at their least size (Blackjack, no banner).
  const phone = (height: number) => ({ width: 356, height });

  it('leaves the seats their natural height in the tier their room gives them, and the cards the rest', () => {
    // One to three others: a row of full tiles (96px and 8px over it), and never under their least height (94px) with a
    // wrapped turn line (21px) over it, so a long name under the ribbon never steps them down to compact mid-round.
    expect(G.seatsNeed(3, phone(171), { growth: G.TURN_WRAP })).toBe(94 + 21);
    expect(G.seatsSpare(3, phone(171), { growth: G.TURN_WRAP })).toBe(56);
    expect(G.seatsSpare(1, phone(171), { growth: G.TURN_WRAP })).toBe(56);
    // Poker's turn line also has its clock to come back: 7px more.
    expect(G.seatsSpare(3, phone(218), { growth: G.TURN_WRAP + G.TURN_CLOCK })).toBe(218 - 94 - 28);
    // Five others: two rows of compact tiles at their natural 68px, the grid's 8px over them.
    expect(G.seatsNeed(5, phone(171), { growth: G.TURN_WRAP })).toBe(2 * 68 + 6 + G.SPARE);
    expect(G.seatsSpare(5, phone(171), { growth: G.TURN_WRAP })).toBe(171 - 150);
    // Nobody else: the ribbon's own row keeps room for a wrapped line, the rest is the cards'.
    expect(G.seatsNeed(0, phone(180), { growth: G.TURN_WRAP })).toBe(21);
    expect(G.seatsSpare(0, phone(180), { growth: G.TURN_WRAP })).toBe(159);
  });

  it('gives a crowd only what is left over its tiles at their natural size: most big tables keep the least card', () => {
    for (const count of [11, 23, 24, 49]) expect(G.seatsSpare(count, phone(171), { growth: G.TURN_WRAP }), `${count} others`).toBe(0);
    // Sixteen others: three rows of small tiles (50px, 4px apart) and the grid's 8px leave 5px.
    expect(G.seatsSpare(16, phone(171), { growth: G.TURN_WRAP })).toBe(171 - (3 * 50 + 2 * 4 + G.SPARE));
    // Never more than the room, and never a negative share.
    expect(G.seatsNeed(49, phone(171))).toBe(171);
    expect(G.seatsSpare(3, phone(70), { growth: G.TURN_WRAP })).toBe(0);
    // Three others in 90px: a row of compact tiles (full ones have no room), their 68px and the 8px over them.
    expect(G.seatsSpare(3, phone(90), { growth: G.TURN_WRAP })).toBe(90 - 76);
    // Whole pixels, rounded down: a room read a fraction apart never moves the cards.
    expect(G.seatsSpare(3, phone(171.7), { growth: G.TURN_WRAP })).toBe(56);
  });

  it('reads the table’s rows once each: the pieces side by side in a row (the line beside the dealer on the shortest phones) count as that row', () => {
    // Head 0-72, the ribbon inside it at 20-56, the stage 220-292: two rows, 144px.
    expect(R.rowsTaken([{ top: 0, bottom: 72 }, { top: 20, bottom: 56 }, { top: 220, bottom: 292 }])).toEqual({ height: 144, rows: 2 });
    // Head, ribbon and stage one under the other, in any order: three rows.
    expect(R.rowsTaken([{ top: 230, bottom: 300 }, { top: 0, bottom: 100 }, { top: 110, bottom: 150 }])).toEqual({ height: 210, rows: 3 });
    // A piece running past the row it sits in takes the row to its bottom.
    expect(R.rowsTaken([{ top: 0, bottom: 72 }, { top: 30, bottom: 90 }])).toEqual({ height: 90, rows: 1 });
    expect(R.rowsTaken([])).toEqual({ height: 0, rows: 0 });
  });

  it('sizes a round by the seats it began with: a player leaving mid-round changes nothing until the next round', () => {
    const start = R.latchSeats(null, 3, 4);
    expect(start).toEqual({ round: 3, count: 4 });
    // Someone leaves in round 3: the cards keep the size the four seats gave them.
    expect(R.latchSeats(start, 3, 3)).toBe(start);
    expect(R.latchSeats(start, 3, 0)).toBe(start);
    // The next round on the table: three seats.
    expect(R.latchSeats(R.latchSeats(start, 3, 3), 4, 3)).toEqual({ round: 4, count: 3 });
    // Nobody is seated mid-game, but a count that rises all the same is taken at once: the seats never lack room.
    expect(R.latchSeats(start, 3, 5)).toEqual({ round: 3, count: 5 });
  });

  it('starts with the cards at their least size: nothing written until the table is laid out, the seats it planned for on the felt', () => {
    const Probe = ({ count }: { count: number }) => {
      const seats = R.useSeatRoom({ current: null }, { round: 1, count, wide: false });
      return createElement('section', { 'data-seats': seats });
    };
    expect(html(createElement(Probe, { count: 3 }))).toBe('<section data-seats="3"></section>');
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    // Registered lengths, so the table reads them as pixels; 0 until written.
    expect(css).toMatch(/@property --tbl-spare \{\s*syntax: '<length>';\s*inherits: false;\s*initial-value: 0px;/);
    expect(css).toMatch(/@property --tbl-grow \{\s*syntax: '<length>';\s*inherits: false;\s*initial-value: 0px;/);
    expect(R.SPARE_VAR).toBe('--tbl-spare');
    expect(R.GROW_VAR).toBe('--tbl-grow');
  });
});

describe('desktop shortcuts', () => {
  const key = (k: string, over: Partial<Parameters<typeof hotkeyOf>[0]> = {}) => hotkeyOf({ key: k, repeat: false, altKey: false, ctrlKey: false, metaKey: false, target: null, ...over });

  it('names a letter or Space, and leaves typing, repeats, modified keys and a focused button alone', () => {
    expect(key('h')).toBe('H');
    expect(key(' ')).toBe('Space');
    expect(key('Enter')).toBeNull();
    expect(key('h', { repeat: true })).toBeNull();
    expect(key('h', { ctrlKey: true })).toBeNull();
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(typingIn(input)).toBe(true);
    expect(key('h', { target: input })).toBeNull();
    expect(typingIn({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    const button = { tagName: 'BUTTON', closest: (s: string) => (s.includes('button') ? {} : null) } as unknown as EventTarget;
    expect(key(' ', { target: button })).toBeNull();
    expect(key('h', { target: button })).toBe('H');
  });

  it('lets a panel button clicked with the mouse let go of the focus (click MAX, then Space bets), not one pressed from the keyboard', () => {
    let blurred = 0;
    const button = { closest: (sel: string) => (sel === 'button' ? { blur: () => void (blurred += 1) } : null) } as unknown as EventTarget;
    releaseClickedButton({ detail: 1, target: button });
    expect(blurred).toBe(1);
    releaseClickedButton({ detail: 0, target: button });
    expect(blurred).toBe(1);
    releaseClickedButton({ detail: 1, target: null });
    expect(blurred).toBe(1);
  });
});

describe('the components', () => {
  it('the panel shell: the label row with the balance, the amount with its steps, the moves, then the table buttons; no status line, no hint', () => {
    const out = html(
      createElement(PanelShell, {
        label: 'Play',
        onSubmit: noop,
        testId: 'panel',
        data: { 'data-amount': 40 },
        actions: createElement(TableButton, { label: 'Sit out', testId: 'sit-out', onClick: noop }),
        children: [
        createElement(PanelLabelRow, { key: 'l', label: 'Bet amount', htmlFor: 'amt', balance: 960, truth: 1000, anchor: 'seat:me' }),
        createElement(AmountField, {
          key: 'a',
          id: 'amt',
          value: '40',
          enabled: true,
          onChange: noop,
          onClear: noop,
          steps: [
            { label: '\u00bd', ariaLabel: 'Half', testId: 'half', onClick: noop },
            { label: 'Max', ariaLabel: 'Max', testId: 'max', onClick: noop, pressed: true },
          ],
          inputTestId: 'amount',
          clearTestId: 'clear',
        }),
        createElement(PanelMoves, { key: 'm', count: 2, children: [createElement(MoveButton, { key: 'h', label: 'Hit', testId: 'hit', enabled: true, onClick: noop, primary: true, hotkey: 'H' }), createElement(MoveButton, { key: 's', label: 'Stand', testId: 'stand', enabled: false, onClick: noop })] }),
        ],
      }),
    );
    expect(out).toMatch(/<form[^>]*data-testid="panel"[^>]*data-amount="40"/);
    // Whose turn it is lives on the table: the panel has no status line and no shortcut hint.
    expect(out).not.toContain('turn-status');
    expect(out).not.toContain('hotkey-hint');
    expect(out).toMatch(/data-testid="my-chips" data-chips="1000" data-table-anchor="seat:me" aria-label="Balance 960 chips"/);
    expect(out).toMatch(/<input[^>]*inputMode="numeric"[^>]*value="40"/);
    expect(out).toContain('data-testid="clear"');
    expect(out).toMatch(/aria-pressed="true" data-testid="max"/);
    expect(out).toMatch(/class="btn btn--primary tbl-move"[^>]*aria-keyshortcuts="H" data-testid="hit"/);
    expect(out).toMatch(/disabled=""[^>]*data-testid="stand"/);
    // The table's own buttons come last, full width.
    expect(out).toMatch(/<div class="tbl-panel__actions"><button type="button" class="btn btn--secondary btn--block tbl-panel__act" data-testid="sit-out">Sit out<\/button><\/div><\/form>$/);
    expect(html(createElement(TableButton, { label: 'Sit out', testId: 'sit-out-off', onClick: noop, enabled: false }))).toContain('disabled=""');
    // A field that is off has no clear button and dims its steps.
    const off = html(createElement(AmountField, { id: 'x', value: '40', enabled: false, onChange: noop, onClear: noop, steps: [{ label: 'MAX', ariaLabel: 'Max', testId: 'max', onClick: noop }], inputTestId: 'amount', clearTestId: 'clear' }));
    expect(off).not.toContain('data-testid="clear"');
    expect(off).toContain('is-off');
    expect(off).toMatch(/disabled=""[^>]*data-testid="max"/);
  });

  it('the players grid: tiles in seat order with the tier and columns on the grid, the turn ringed and tagged, a dimmed seat, a badge and data for the tests', () => {
    const avatar = { color: 1, emoji: 2 };
    const tile = (id: string, name: string, extra: Record<string, unknown>) =>
      createElement(PlayerTile, { key: id, playerId: id, name, avatar, connected: true, tier: 'full', turn: false, line: { state: 'waiting', text: 'Waiting', tone: 'quiet' }, mark: 'waiting', ...extra });
    const out = html(
      createElement(PlayersGrid, {
        count: 2,
        label: 'Other players',
        children: (tier) => [
          tile('p1', 'Pia', { tier, chips: 980, turn: true, line: { state: 'turn', text: 'Thinking', tone: 'turn' }, mark: 'turn', badge: createElement('b', { key: 'd' }, 'D'), data: { 'data-bet': 20 }, onOpen: noop }),
          tile('p2', 'Quinn', { tier, connected: false, chips: 0, line: { state: 'out', text: 'Out', tone: 'bad' }, mark: 'out', dimmed: true }),
        ],
      }),
    );
    expect(out).toMatch(/<ul class="tbl-grid tbl-grid--full"[^>]*aria-label="Other players" data-testid="seats" data-tier="full" data-cols="2" data-count="2">/);
    expect(out.match(/class="tbl-grid__cell"/g)).toHaveLength(2);
    expect(out).toMatch(/class="tbl-tile tbl-tile--full tbl-tile--turn"[^>]*data-player-id="p1"[^>]*data-turn="true" aria-current="true" data-bet="20"/);
    expect(out).toContain('data-testid="seat-playing">Playing<');
    expect(out).toContain('tbl-tile__line--turn');
    expect(out).toMatch(/class="tbl-tile tbl-tile--full tbl-tile--dim"[^>]*data-player-id="p2"/);
    expect(out).toContain('data-table-anchor="seat:p1"');
    expect(out).toContain('avatar--dimmed');
    // Only a tile with a sheet to open is a button.
    expect(out.match(/data-testid="seat-open"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Pia: Thinking. Show details"');
  });

  it('a tile shows its cards only in the full tier, and an outcome outlines it once settled', () => {
    const avatar = { color: 1, emoji: 2 };
    const props = { playerId: 'p1', name: 'Pia', avatar, connected: true, turn: false, line: { state: 'settled', text: 'Win +40', tone: 'strong' as const }, mark: 'win' as const, outcome: 'win' as const, total: { text: '20', tone: 'win' as const }, cards: createElement('i', null, 'cards') };
    expect(html(createElement(PlayerTile, { ...props, tier: 'full' }))).toContain('<i>cards</i>');
    const many = html(createElement(PlayerTile, { ...props, tier: 'small' }));
    expect(many).not.toContain('<i>cards</i>');
    expect(many).toContain('tbl-tile--small tbl-tile--win');
    expect(many).toContain('data-testid="seat-total"');
    expect(html(createElement(PlayerTile, { ...props, tier: 'dense' }))).toContain('tbl-tile--dense');
  });

  it('a narrow full tile on a phone, dealt in: the words on the left under the name, the cards on the right half as big again, the total on the last card', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    const phone = css.slice(css.indexOf('@container tile (max-width: 199px) and (min-height: 80px) {'));
    const block = phone.slice(0, phone.indexOf('\n}\n'));
    expect(block).toMatch(/\.tbl-grid:not\(\.tbl-grid--arc\) \.tbl-tile--full \{[^}]*grid-template-columns: var\(--face\) fit-content\(30px\) minmax\(0, 1fr\);[^}]*grid-template-areas: 'face name name' 'face chips chips' '\. \. cards' 'bet bet cards' 'line line cards' '\. \. cards';/);
    // As tall as the room under the stack (34.6px on a 96px tile, 22px before), as wide as the room the words leave (the cards' own box), a split row keeping its peek.
    expect(block).toMatch(/--tbl-w: min\(calc\(\(100cqh - 40px\) \/ 1\.62\), calc\(100cqw \/ var\(--tile-k\)\), max\(22px, calc\(\(100cqw - 2 \* var\(--tile-peek\)\) \/ var\(--tile-k\)\)\)\);\s*container-type: inline-size;/);
    expect((96 - 40) / 1.62 / 22).toBeGreaterThan(1.5);
    expect(block).toMatch(/\.tbl-hand--mini \.tbl-hand__head \{\s*position: absolute;\s*top: auto;\s*right: 0;\s*bottom: 0;/);
    // A wide tile's words keep their room beside a row of split hands.
    expect(css).toMatch(/\.tbl-tile\.tbl-tile--full \.tbl-tile__cards \{[^}]*max-width: calc\(100cqw - 160px\);/);
    const props = { playerId: 'p1', name: 'Pia', avatar: { color: 1, emoji: 2 }, connected: true, tier: 'full' as const, turn: false, line: { state: 'waiting', text: 'Waiting', tone: 'quiet' as const }, mark: 'waiting' as const, cards: createElement('i', null, 'cards') };
    expect(html(createElement(PlayerTile, { ...props, fan: { cards: 4, hands: 3 } }))).toContain('<span class="tbl-tile__cards" style="--tile-fan:4;--tile-hands:3"><i>cards</i></span>');
    expect(html(createElement(PlayerTile, props))).toContain('<span class="tbl-tile__cards"><i>cards</i></span>');
  });

  it('a narrow full tile before the deal, and on a desktop (three on a phone, six across a desktop), gives the name, the stack, the bet with the status and the cards a row each, so nothing is drawn over anything', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@container tile (max-width: 199px)'));
    const block = narrow.slice(0, narrow.indexOf('\n}\n'));
    expect(block).toMatch(/\.tbl-tile--full \{[^}]*grid-template-areas: 'face name name' 'face chips chips' 'bet bet line' 'cards cards cards';/);
    // The stack, the bet and the status leave their flex row for the grid's own rows; the Playing tag goes (the ring says it).
    expect(block).toMatch(/\.tbl-tile--full \.tbl-tile__meta \{\s*display: contents;/);
    expect(block).toMatch(/\.tbl-tile--full \.tbl-tile__tag \{\s*display: none;/);
    for (const part of ['chips', 'bet', 'line']) expect(block).toMatch(new RegExp(`\\.tbl-tile--full \\.tbl-tile__${part} \\{\\s*grid-area: ${part};`));
    // The full tier is never squeezed short enough to need a layout without the cards: those rules are gone.
    expect(css).not.toMatch(/@container tile \(max-height: 91px\)/);
    // A stack too long for its row reads short, measured as it lays out (StackCount, fit.tsx): an ellipsis never showed on it, its
    // box being a flex one, and "100,000 chips" was simply cut on a full tile three across a 360px phone.
    expect(block).toMatch(/\.tbl-tile--full \.tbl-tile__chips \{\s*grid-area: chips;\s*min-width: 0;\s*overflow: hidden;\s*\}/);
  });

  it('a wide full tile (one other player on a phone, up to three on a desktop) has its words on the left and its cards on the right, a size up', async () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    const side = css.slice(css.indexOf('@container tile (min-width: 270px) {'));
    const block = side.slice(0, side.indexOf('\n}\n'));
    // The avatar and the name on top, the stack, the bet pill and the status on one line under both, the cards beside them all.
    expect(block).toMatch(/\.tbl-tile--full \{[^}]*grid-template-areas: 'face name tag cards' 'meta meta meta cards';/);
    // The cards 6px wider than the miniature (a phone's 22px, 28px) and never taller than the tile.
    expect(block).toMatch(/\.tbl-tile\.tbl-tile--full \.tbl-tile__cards \{\s*--tbl-w: min\(calc\(var\(--tbl-mini-w, 24px\) \+ 6px\), calc\(\(100cqh - 16px\) \/ 1\.62\)\);/);
    // A full tile may grow to 300px where the row has the room, so a lone one on a phone (and a desktop's row of three) takes it.
    expect(css).toMatch(/\.tbl-grid--full \{\s*grid-template-columns: repeat\(var\(--cols, 4\), minmax\(0, max\(calc\(var\(--tile-w, 120px\) \* 1\.3\), 300px\)\)\);/);
    expect(css).toMatch(/\.tbl-grid--arc\.tbl-grid--full \{\s*grid-template-columns: repeat\(calc\(var\(--cols, 4\) \* 2\), minmax\(0, max\(calc\(var\(--tile-w, 120px\) \* 0\.65\), 150px\)\)\);/);
    // The stack under the avatar starts 2px below the badge on its corner (3px under the avatar).
    expect(block).toMatch(/\.tbl-tile--full \{[^}]*row-gap: 5px;/);
    // Before the deal the tile keeps its words: the avatar's row, the 5px under it and the pill's line (54.3px) and its padding
    // and border (13px).
    const { BARE_FULL_HEIGHT, tileHeight } = await import('./grid');
    expect(BARE_FULL_HEIGHT).toBe(68);
    expect(tileHeight('full', false, true)).toBe(68);
    expect(tileHeight('full', false, false)).toBe(96);
  });

  it('the line under the ribbon: whose turn it is in its tone, the quieter second part, the clock before it', () => {
    const out = html(createElement(TurnLine, { text: "Pia’s turn", tone: 'other', state: 'turn', sub: 'Quinn raises to 40', clock: createElement('span', { 'data-testid': 'timer' }) }));
    expect(out).toMatch(/^<p class="tbl-turn tbl-turn--other" data-testid="table-turn" data-state="turn"><span class="tbl-turn__clock"><span data-testid="timer"><\/span><\/span><span class="tbl-turn__text">Pia’s turn<\/span><span class="tbl-turn__sub" data-testid="turn-sub">Quinn raises to 40<\/span><\/p>$/);
    const plain = html(createElement(TurnLine, { text: 'Your turn', tone: 'go', state: 'mine' }));
    expect(plain).not.toContain('tbl-turn__sub');
    expect(plain).not.toContain('tbl-turn__clock');
  });

  it('the stage: the hand alone, big and centred, with no columns beside it', () => {
    const other = html(createElement(TableStage, { variant: 'other', label: "Pia’s hand", data: { 'data-player-id': 'p1' }, children: createElement('u', null, 'hand') }));
    expect(other).toBe('<section class="tbl-stage tbl-stage--other" aria-label="Pia’s hand" data-testid="hand-stage" data-player-id="p1"><u>hand</u></section>');
    expect(html(createElement(TableStage, { variant: 'none', label: 'Hands' }))).toBe('<section class="tbl-stage tbl-stage--none" aria-label="Hands" data-testid="hand-stage"></section>');
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).not.toContain('tbl-stage__owner');
    expect(css).not.toContain('tbl-stage__aside');
  });

  it('lays the moves two to a row, three in one row, and tells a phone how many to put in its one row', () => {
    const moves = (count: number) => html(createElement(PanelMoves, { count, children: [] }));
    expect(moves(4)).toBe('<div class="tbl-panel__moves" style="--moves:4" role="group" aria-label="Your moves"></div>');
    expect(moves(3)).toContain('class="tbl-panel__moves tbl-panel__moves--3" style="--moves:3"');
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).toMatch(/\.tbl-panel__moves \{\s*grid-template-columns: repeat\(var\(--moves, 2\), minmax\(0, 1fr\)\);/);
  });

  it('puts the quick amounts under the field on a desktop, joined to it on a phone, and never cuts the figure', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).toMatch(/\.tbl-amount \{\s*display: flex;\s*flex-direction: column;/);
    expect(css).toMatch(/\.tbl-amount__input \{[^}]*min-width: 7\.5ch;/);
    const phone = css.slice(css.indexOf('/* The panel kept short'));
    expect(phone).toMatch(/^[^@]*\.tbl-amount \{\s*flex-direction: row;/);
    // Numbers in the main fonts with even figures, never a monospace.
    expect(css).not.toContain('font-mono');
  });

  it('lays a calm table out in four rows: the centre piece and the stage fixed at the edges, the ribbon and the seats between in one rhythm', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).toMatch(/\.tbl-felt--calm \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);\s*grid-template-rows: var\(--tbl-head-h\) auto minmax\(0, max-content\) var\(--tbl-stage-h\);\s*grid-template-areas: 'head' 'ribbon' 'seats' 'stage';\s*align-content: space-between;/);
    // The seats ask for no more than their tiles need, so the room left is shared evenly.
    expect(css).toMatch(/\.tbl-felt--calm > \.tbl-grid \{[^}]*height: var\(--grid-natural, auto\);[^}]*max-height: 100%;/);
    // The deck sits wholly on the felt, inside its padding.
    expect(css).toMatch(/\.tbl-deck--corner \{[^}]*top: var\(--tbl-pad\);/);
    // Whose turn it is stays, even where the banner goes.
    expect(css).toMatch(/\.tbl-felt--calm > \.tbl-ribbon \{\s*grid-area: ribbon;\s*display: flex;/);
    expect(css).toMatch(/\.tbl-felt--calm \.tbl-ribbon__band \{\s*display: none;/);
  });
  it('the deck, the ribbon, the pill, the outline and the payout', () => {
    expect(html(createElement(Deck, { remaining: 268, name: 'shoe', testId: 'shoe' }))).toMatch(/data-testid="shoe" data-remaining="268" aria-label="268 cards in the shoe"[\s\S]*data-table-deck=""[\s\S]*268</);
    // An endless deck: the stack and no count.
    const endless = html(createElement(Deck, { name: 'shoe', testId: 'shoe' }));
    expect(endless).toMatch(/data-testid="shoe" aria-label="The shoe"[\s\S]*data-table-deck=""/);
    expect(endless).not.toContain('tbl-deck__count');
    // In the corner the count is said, not shown.
    const corner = html(createElement(Deck, { remaining: 40, name: 'deck', testId: 'deck', corner: true }));
    expect(corner).toMatch(/class="tbl-deck tbl-deck--corner" data-testid="deck" data-remaining="40" aria-label="40 cards in the deck"/);
    expect(corner).not.toContain('tbl-deck__count');
    const ribbon = html(createElement(TableRibbon, { main: 'Blackjack pays 3 to 2', sub: 'Round 1 · Dealer stands on 17', note: createElement('p', null, 'Your turn') }));
    expect(ribbon).toContain('<span class="tbl-ribbon__sub">Round 1 · Dealer stands on 17</span>');
    // The line under it is read out as it changes.
    expect(ribbon).toContain('<div class="tbl-ribbon__note" role="status" aria-live="polite"><p>Your turn</p></div>');
    expect(html(createElement(TableRibbon, { main: 'No limit' }))).not.toContain('tbl-ribbon__sub');
    // Words in the main fonts as written: no capitals or letter spacing laid over them.
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).not.toContain('text-transform: uppercase');
    expect(html(createElement(TotalPill, { tone: 'win', testId: 'pill', children: '21' }))).toBe('<span class="tbl-pill tbl-pill--win" data-testid="pill">21</span>');
    expect(outlineClass('loss')).toBe('tbl-outline tbl-outline--loss');
    expect(html(createElement(PayoutFloat, { text: '+220', tone: 'blackjack' }))).toBe('<span class="tbl-payout tbl-payout--blackjack" aria-hidden="true">+220</span>');
  });

  it('a card: face down without a rank, turning over with its back and face stacked, lifted when it plays', () => {
    const down = html(createElement(TableCard, { card: null, size: 'md', motion: null, leaving: false, testId: 'card' }));
    expect(down).toContain('data-face="down"');
    expect(down).not.toContain('data-rank');
    const turning = html(createElement(TableCard, { card: { rank: 'A', suit: 'S' }, size: 'md', motion: null, leaving: false, flipping: true, highlight: true, testId: 'card' }));
    expect(turning).toMatch(/class="tbl-flip" style="animation-duration:400ms"/);
    expect(turning).toContain('tbl-flip__back');
    expect(turning).toMatch(/playing-card--highlight tbl-flip__front[^>]*data-rank="A"/);
  });

  it('chips in the air: one hidden token per flight until it is placed over its source, nothing without flights', () => {
    expect(html(createElement(ChipFlights, { flights: [] }))).toBe('');
    const out = html(createElement(ChipFlights, { flights: [{ id: 'f1', from: 'seat:p1', to: 'pot', amount: 1200, at: NOW, ms: 300 }] }));
    expect(out).toMatch(/class="tbl-flights" aria-hidden="true"/);
    expect(out).toContain('1,200');
    expect(out).toContain('visibility:hidden');
  });
});

describe('a spectator of the whole game', () => {
  it('is anyone not playing in it, and reads one line in place of the controls', () => {
    const players = [{ id: 'a', participating: true }, { id: 'b', participating: false }];
    expect(isWatching(players, 'a')).toBe(false);
    expect(isWatching(players, 'b')).toBe(true);
    expect(isWatching(players, 'nobody')).toBe(true);
    const panel = html(createElement(WatchingPanel, { testId: 'pk-panel' }));
    expect(panel).toContain('data-watching="true"');
    expect(panel).toContain('data-testid="watching-note"');
    expect(panel).toContain(WATCHING_TEXT.replace("'", '&#x27;'));
    expect(panel).not.toContain('<button');
    expect(panel).not.toContain('<input');
    // A watching host keeps their table buttons under the line.
    const host = html(createElement(WatchingPanel, { testId: 'bj-panel', actions: createElement('button', { 'data-testid': 'deal-now' }, 'Deal now') }));
    expect(host).toContain('data-testid="deal-now"');
  });

  it('wraps the line rather than cutting it', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    const rule = css.slice(css.indexOf('.tbl-panel__watching {'), css.indexOf('}', css.indexOf('.tbl-panel__watching {')));
    expect(rule).toContain('text-wrap: pretty');
    expect(rule).not.toContain('nowrap');
    expect(WATCHING_TEXT).not.toContain('\u2014');
  });
});

describe('the words on a table read whole', () => {
  it('steps a text to its next, shorter form only while its box overflows, and keeps the last', async () => {
    const F = await import('./fit');
    expect(F.overflows({ scrollWidth: 80, clientWidth: 80 })).toBe(false);
    expect(F.overflows({ scrollWidth: 80.4, clientWidth: 80 })).toBe(false);
    expect(F.overflows({ scrollWidth: 81, clientWidth: 80 })).toBe(true);
    const steps: [number, number, boolean, number][] = [
      [0, 3, true, 1],
      [1, 3, true, 2],
      [2, 3, true, 2],
      [0, 3, false, 0],
      [1, 3, false, 1],
      [0, 1, true, 0],
      [0, 2, true, 1],
    ];
    for (const [at, count, cut, next] of steps) expect(F.nextForm(at, count, cut), `${at} of ${count}, cut ${cut}`).toBe(next);
  });

  it('starts a text over only where its row may have given it more room, never for a shorter form of its own', async () => {
    const F = await import('./fit');
    const pill = {};
    const name = {};
    const then = { width: 47, kin: [{ el: pill, width: 81, height: 20 }, { el: name, width: 60, height: 14 }] };
    // The same row: nothing freed. A shorter form shrinks the text's own box and lets its siblings grow: still nothing.
    expect(F.freed(then, then)).toBe(false);
    expect(F.freed(then, { width: 40, kin: then.kin })).toBe(false);
    expect(F.freed(then, { width: 47, kin: [{ el: pill, width: 90, height: 22 }, { el: name, width: 60, height: 14 }] })).toBe(false);
    expect(F.freed(then, { width: 47.4, kin: then.kin })).toBe(false);
    // The text's own box wider (the bet pill shrank to its chips, the street closed), a sibling narrower, shorter or gone: freed.
    expect(F.freed(then, { width: 100, kin: then.kin })).toBe(true);
    expect(F.freed(then, { width: 47, kin: [{ el: pill, width: 28, height: 20 }, { el: name, width: 60, height: 14 }] })).toBe(true);
    expect(F.freed(then, { width: 47, kin: [{ el: pill, width: 81, height: 14 }, { el: name, width: 60, height: 14 }] })).toBe(true);
    expect(F.freed(then, { width: 47, kin: [{ el: name, width: 60, height: 14 }] })).toBe(true);
    // A new sibling takes room, it never frees any.
    expect(F.freed(then, { width: 47, kin: [...then.kin, { el: {}, width: 30, height: 20 }] })).toBe(false);
  });

  it('counts two boxes as lying over each other only past a half-pixel touch both ways', async () => {
    const F = await import('./fit');
    const box = { left: 0, right: 100, top: 0, bottom: 20 };
    const meets: [{ left: number; right: number; top: number; bottom: number }, boolean][] = [
      [{ left: 50, right: 150, top: 10, bottom: 30 }, true],
      [{ left: 99.6, right: 150, top: 0, bottom: 20 }, false],
      [{ left: 99, right: 150, top: 0, bottom: 20 }, true],
      [{ left: 0, right: 100, top: 19.5, bottom: 40 }, false],
      [{ left: 0, right: 100, top: 19, bottom: 40 }, true],
      [{ left: 120, right: 150, top: 0, bottom: 20 }, false],
    ];
    for (const [other, over] of meets) expect(F.meets(box, other), JSON.stringify(other)).toBe(over);
  });

  it('a tile shows the fullest form of its line and its stack on the server render, keeping the shorter ones for a narrow tile', async () => {
    const avatar = { color: 1, emoji: 2 };
    const props = { playerId: 'p1', name: 'Ravi', avatar, connected: true, tier: 'full' as const, turn: false, mark: 'done' as const, chips: 100_000, onOpen: noop };
    const raised = html(createElement(PlayerTile, { ...props, line: { state: 'acted', text: 'Raise to 12,000', tone: 'quiet', short: ['Raise 12k', 'Raise'] } }));
    expect(raised).toContain('<span class="tbl-tile__line tbl-tile__line--quiet" data-testid="seat-line" data-fit="0">Raise to 12,000</span>');
    // The stack writes both figures; the stylesheet picks one by the tile's width, and the measured fit the short one where that is still cut.
    expect(raised).toContain('data-testid="seat-chips" data-chips="100000" data-long=""><span class="tbl-stackcount__value tbl-figure"><span class="tbl-figure__full">100,000</span><span class="tbl-figure__short">100k</span></span>');
    // The open button's label (what a screen reader gets) says the line in full, whatever form the tile shows.
    expect(raised).toContain('aria-label="Ravi: Raise to 12,000. Show details" data-testid="seat-open"');
    const plain = html(createElement(PlayerTile, { ...props, line: { state: 'waiting', text: 'Waiting', tone: 'quiet' } }));
    expect(plain).toContain('<span class="tbl-tile__line tbl-tile__line--quiet" data-testid="seat-line">Waiting</span>');
    // A stake by my hand on the stage, and a tile's stack, render as any: in full where it fits, measured as they lay out.
    const F = await import('./fit');
    expect(html(createElement(StakePill, { value: 12_000, start: 100_000, format: 'fit', fit: F.STAGE_FIT }))).toBe(html(createElement(StakePill, { value: 12_000, start: 100_000, format: 'fit' })));
    expect(html(createElement(StackCount, { value: 1_250_000, format: 'fit', fit: F.TILE_FIT }))).toBe(html(createElement(StackCount, { value: 1_250_000, format: 'fit' })));
    expect(F.TILE_FIT.box).toBe(F.tileOf);
  });

  it('keeps a crushed compact tile’s total inside it', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    // Ten players on a 375x667 phone leave compact tiles 16px tall: the total's 18px pill shrinks to keep inside the tile.
    const short = css.slice(css.indexOf('@container tile (max-height: 46px) {\n  .tbl-tile--compact,'));
    expect(short).toMatch(/^@container tile \(max-height: 46px\) \{[^@]*\.tbl-tile--compact \.tbl-tile__total \.tbl-pill \{\s*height: min\(18px, calc\(100cqh - 2px\)\);/);
  });

  it('keeps every card’s corner clear: a hand’s words come down over its cards only as far as their corners begin', () => {
    const cards = readFileSync(join(import.meta.dirname, '../styles/cards.css'), 'utf8');
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    // The corner (rank and suit) begins 0.1 card widths below the top edge; the words over a hand come down that far and no further.
    expect(cards).toMatch(/:root \{\s*--card-index-top: 0\.1;/);
    expect(cards).toMatch(/\.playing-card__corner \{\s*position: absolute;\s*top: calc\(var\(--card-w\) \* var\(--card-index-top\)\);/);
    expect(css).toMatch(/\.tbl-hand \{\s*--pill-h: var\(--tbl-pill-h, 26px\);\s*--head-over: calc\(var\(--tbl-w\) \* var\(--card-index-top\)\);[^}]*padding: calc\(var\(--pill-h\) - var\(--head-over\)\) 3px 3px;/);
    expect(css).toMatch(/\.tbl-hand__head \{\s*position: absolute;\s*top: 0;/);
    // A hand is its pill's height and 1.67 card widths tall (the fan's 1.77 less that overlap): the games size their rows by it.
    expect(css).toMatch(/:root \{\s*--fan-step: 0\.44;\s*\/\*[^*]*\*\/\s*--hand-k: calc\(1\.77 - var\(--card-index-top\)\);/);
    expect(css).not.toMatch(/--pill-h\) \* 0\.7/);
    // The badge on a tile's avatar reaches 2px past it, inside the 4px a full tile keeps between the face and the words (6px on a
    // wide one), so a tick never runs into the stack's first figure (e2e tilesReadable measures it on every tier).
    expect(css).toMatch(/\.tbl-tile__mark \{\s*position: absolute;\s*right: -2px;\s*bottom: -3px;/);
    expect(css).toMatch(/\n\.tbl-tile \{[^}]*column-gap: 6px;/);
    expect(css.slice(css.indexOf('@container tile (max-width: 199px) {\n  .tbl-tile--full {'))).toMatch(/^@container tile \(max-width: 199px\) \{\s*\.tbl-tile--full \{\s*--face: 24px;\s*column-gap: 4px;/);
    // Where the stack's line runs under the face (a narrow compact tile) the badge keeps to the avatar's height; the small tiles'
    // dot keeps clear of the name under it.
    expect(css).toMatch(/\.tbl-tile--compact \.tbl-tile__mark \{\s*bottom: 0;/);
    expect(css).toMatch(/\.tbl-tile--small \.tbl-tile__mark,\s*\.tbl-tile--dense \.tbl-tile__mark \{[^}]*left: -3px;\s*right: auto;\s*bottom: 0;/);
  });
});

describe('the stack and the stake', () => {
  it('words the stack as chips and the stake as a labelled figure, in full or short', () => {
    expect(S.stackText(1000)).toBe('1,000 chips');
    expect(S.stackText(1)).toBe('1 chip');
    expect(S.stackText(0)).toBe('0 chips');
    expect(S.stackText(12_500, 'short')).toBe('13k chips');
    expect(S.stackText(1_250, 'short')).toBe('1.3k chips');
    expect(S.stakeText(10)).toBe('Bet 10');
    expect(S.stakeText(1_500)).toBe('Bet 1,500');
    expect(S.stakeText(120, 'Pot')).toBe('Pot 120');
    expect(S.stakeText(25_000, 'Bet', 'short')).toBe('Bet 25k');
  });

  it('sets the chip denominations from the starting stack, never from the bet: 1%, 5%, 25% and the whole stack', () => {
    const values = (start: number) => S.denominationsFor(start).map((d) => d.value);
    expect(S.denominationsFor(1000)).toEqual([
      { band: 'white', value: 10 },
      { band: 'lime', value: 50 },
      { band: 'lilac', value: 250 },
      { band: 'ink', value: 1000 },
    ]);
    expect(values(10_000)).toEqual([100, 500, 2500, 10_000]);
    expect(values(100)).toEqual([1, 5, 25, 100]);
    // Whole chips at an odd start, never under one.
    expect(values(150)).toEqual([2, 8, 38, 150]);
    expect(values(1)).toEqual([1, 1, 1, 1]);
  });

  it('breaks a bet into chips greedily from the largest, caps the drawing and marks what is owed with a plus', () => {
    const chips = (bet: number, start: number, max?: number) => S.betChips(bet, start, max);
    // At a 1,000 start: 10 is one off-white chip, 50 one lime, 200 four lime (three drawn and a plus), 1,000 one ink.
    expect(chips(10, 1000)).toEqual({ bands: ['white'], count: 1, more: false });
    expect(chips(50, 1000)).toEqual({ bands: ['lime'], count: 1, more: false });
    expect(chips(200, 1000)).toEqual({ bands: ['lime', 'lime', 'lime'], count: 4, more: true });
    expect(chips(200, 1000, 2)).toEqual({ bands: ['lime', 'lime'], count: 4, more: true });
    expect(chips(1000, 1000)).toEqual({ bands: ['ink'], count: 1, more: false });
    // Ten times the start (won back and pushed in): ink chips, capped, with a plus.
    expect(chips(10_000, 1000)).toEqual({ bands: ['ink', 'ink', 'ink'], count: 10, more: true });
    // Mixed change, biggest first: an ink chip and four off-white, two drawn.
    expect(chips(1040, 1000, 2)).toEqual({ bands: ['ink', 'white'], count: 5, more: true });
    expect(chips(300, 1000)).toEqual({ bands: ['lilac', 'lime'], count: 2, more: false });
    // At a 10,000 start the chips are ten times bigger: 10 and 50 are each one off-white chip, 200 two, 1,000 two lime, 10,000 one ink.
    expect(chips(10, 10_000)).toEqual({ bands: ['white'], count: 1, more: false });
    expect(chips(50, 10_000)).toEqual({ bands: ['white'], count: 1, more: false });
    expect(chips(200, 10_000)).toEqual({ bands: ['white', 'white'], count: 2, more: false });
    expect(chips(1000, 10_000)).toEqual({ bands: ['lime', 'lime'], count: 2, more: false });
    expect(chips(10_000, 10_000)).toEqual({ bands: ['ink'], count: 1, more: false });
    // At a 100 start: 1, 5, 25 and 100.
    expect(chips(1, 100)).toEqual({ bands: ['white'], count: 1, more: false });
    expect(chips(5, 100)).toEqual({ bands: ['lime'], count: 1, more: false });
    expect(chips(25, 100)).toEqual({ bands: ['lilac'], count: 1, more: false });
    expect(chips(100, 100)).toEqual({ bands: ['ink'], count: 1, more: false });
    // The change under one chip is one off-white chip; a bet of nothing is still one chip, never an empty pill.
    expect(chips(5, 1000)).toEqual({ bands: ['white'], count: 1, more: false });
    expect(chips(55, 1000)).toEqual({ bands: ['lime', 'white'], count: 2, more: false });
    expect(chips(0, 1000)).toEqual({ bands: ['white'], count: 1, more: false });
    // A cap under one still draws one chip.
    expect(chips(300, 1000, 0)).toEqual({ bands: ['lilac'], count: 2, more: true });
  });

  it('renders the stack as a bold figure and a word, the stake as its own pill of chips: never two bare numbers side by side', () => {
    expect(html(createElement(StackCount, { value: 1000, testId: 'stack' }))).toBe('<span class="tbl-stackcount" data-testid="stack" data-chips="1000"><span class="tbl-stackcount__value">1,000</span> <span class="tbl-stackcount__word">chips</span></span>');
    expect(html(createElement(StackCount, { value: 1 }))).toContain('>chip<');
    // A five-digit stack is marked long, so a narrow tile can read it short.
    expect(html(createElement(StackCount, { value: 12_500, format: 'fit' }))).toBe('<span class="tbl-stackcount" data-chips="12500" data-long=""><span class="tbl-stackcount__value tbl-figure"><span class="tbl-figure__full">12,500</span><span class="tbl-figure__short">13k</span></span> <span class="tbl-stackcount__word">chips</span></span>');
    expect(html(createElement(StackCount, { value: 9_000 }))).not.toContain('data-long');
    // A bet: the chips in place of the word, the figure beside them, "Bet 10" as its label.
    const bet = html(createElement(StakePill, { value: 10, start: 1000, testId: 'bet' }));
    expect(bet).toMatch(/^<span class="tbl-stake tbl-stake--bet" role="img" aria-label="Bet 10" data-testid="bet" data-bet="10" data-chips="1" data-bands="white"><span class="tbl-stake__chips" aria-hidden="true" data-count="1"><svg class="tbl-stake__chip" viewBox="0 0 25\.5 25\.5">/);
    expect(bet).toMatch(/<g class="tbl-chip tbl-chip--white" data-band="white"><circle class="tbl-chip__shadow"[^>]*><\/circle><circle class="tbl-chip__disc"[^>]*><\/circle><circle class="tbl-chip__spots"[^>]*><\/circle><circle class="tbl-chip__ring"[^>]*><\/circle><\/g><\/svg><\/span><span class="tbl-stake__value">10<\/span><\/span>$/);
    expect(bet).not.toContain('tbl-stake__word');
    expect(bet).not.toContain('tbl-stake__more');
    // Two chips with a plus: the pill is wider than the word was; a chip each, so a narrow tile can keep the first alone.
    const wide = html(createElement(StakePill, { value: 200, start: 1000, chips: 2, format: 'fit' }));
    expect(wide).toMatch(/^<span class="tbl-stake tbl-stake--bet tbl-stake--wide" role="img" aria-label="Bet 200" data-bet="200" data-chips="4" data-bands="lime lime"><span class="tbl-stake__chips" aria-hidden="true" data-count="2"><svg class="tbl-stake__chip"[^>]*><g class="tbl-chip tbl-chip--lime"/);
    expect(wide.match(/<svg class="tbl-stake__chip"/g)).toHaveLength(2);
    expect(wide).toMatch(/<\/svg><\/span><span class="tbl-stake__more" aria-hidden="true">\+<\/span><span class="tbl-stake__value">200<\/span><\/span>$/);
    // Every chip drawn (a lilac and a lime for 300): a spare plus, hidden unless a narrow tile hides the second chip.
    expect(html(createElement(StakePill, { value: 300, start: 1000 }))).toMatch(/data-chips="2" data-bands="lilac lime">[\s\S]*<\/span><span class="tbl-stake__more tbl-stake__more--spare" aria-hidden="true">\+<\/span><span class="tbl-stake__value">300<\/span>/);
    // One ink chip for the whole stack, three chips at most by default, and the short figure where asked.
    expect(html(createElement(StakePill, { value: 1000, start: 1000 }))).toContain('data-chips="1" data-bands="ink"');
    expect(html(createElement(StakePill, { value: 10_000, start: 1000, format: 'short' }))).toMatch(/data-chips="10" data-bands="ink ink ink" data-long="">[\s\S]*<span class="tbl-stake__value">10k<\/span>/);
    // A four-digit stake is marked long, so a narrow compact tile can read it short; a three-digit one is not.
    expect(html(createElement(StakePill, { value: 1000, start: 1000, format: 'fit' }))).toMatch(/data-chips="1" data-bands="ink" data-long=""><span class="tbl-stake__chips"[\s\S]*<span class="tbl-figure__full">1,000<\/span><span class="tbl-figure__short">1k<\/span>/);
    expect(html(createElement(StakePill, { value: 999, start: 1000 }))).not.toContain('data-long');
    // The pot keeps its word.
    expect(html(createElement(StakePill, { value: 120, kind: 'pot' }))).toBe('<span class="tbl-stake tbl-stake--pot" data-bet="120"><span class="tbl-stake__word">Pot</span> <span class="tbl-stake__value">120</span></span>');
    // The stake is the gold pill, the stack plain words: told apart by shape and colour, not just position.
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).toMatch(/\.tbl-stake \{[^}]*border: 1\.5px solid var\(--color-warning\);[^}]*background: var\(--color-warning-soft\);/);
    expect(css).toMatch(/\.tbl-stackcount__value \{[^}]*font-weight: 800;/);
  });

  it('draws the chips the pill\u2019s height less 5px in the brand\u2019s flat colours, the ink chip with a lime edge, spots only where they read', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    // The pill keeps its height (--stake-h, which every rule that resizes a pill sets) and only widens; the chips are 5px shorter, each two thirds over the one before.
    expect(css).toMatch(/\.tbl-stake \{\s*\/\*[^*]*\*\/\s*--stake-h: 1\.85em;[^}]*height: var\(--stake-h\);/);
    expect(css).toMatch(/\.tbl-stake__chip \{\s*display: block;\s*flex: none;\s*height: calc\(var\(--stake-h\) - 5px\);\s*width: auto;/);
    expect(css).toMatch(/\.tbl-stake__chip \+ \.tbl-stake__chip \{\s*margin-left: calc\(\(var\(--stake-h\) - 5px\) \* -2 \/ 3\);/);
    // A compact tile under 100px (ten players on a 390px phone, five to nine on a 320px one) keeps the first chip alone, shows the spare plus and packs the pill tighter, so a chip, the plus and "1.3k" keep inside a 64px tile on its own line.
    expect(css).toMatch(/\.tbl-stake__more--spare \{\s*display: none;/);
    const tiny = css.slice(css.indexOf('@container tile (max-width: 99px)'), css.indexOf('@container tile (max-height: 46px) and (max-width: 79px)'));
    expect(tiny).toMatch(/\.tbl-tile--compact \.tbl-stake__chip \+ \.tbl-stake__chip \{\s*display: none;/);
    expect(tiny).toMatch(/\.tbl-tile--compact \.tbl-stake__more--spare \{\s*display: inline;/);
    expect(tiny).toMatch(/\.tbl-tile--compact \.tbl-stake \{\s*gap: 0\.15em;\s*padding: 0 0\.25em 0 0\.2em;/);
    // There the stack's word gives way to the hand's total on its line ("800" and "18"), never on a Poker tile, whose total badge is hidden there.
    expect(tiny).toMatch(/\.tbl-tile--compact:not\(\.tbl-tile--short-badge\):has\(> \.tbl-tile__total\) \.tbl-stackcount__word \{\s*display: none;/);
    // A slimmer total there, so a six-figure stack ("100k") keeps whole beside it in the turn ring of a 66px tile.
    expect(tiny).toMatch(/\.tbl-tile--compact \.tbl-tile__total \.tbl-pill \{\s*min-width: 18px;\s*padding: 0 2px;/);
    expect(css).toMatch(/\.tbl-hand__head \.tbl-hand__stake \{\s*--stake-h: var\(--pill-h\);/);
    // No rule sets a stake pill's height behind the variable's back.
    for (const file of ['../styles/table.css', '../../games/blackjack/blackjack.css', '../../games/poker/poker.css']) {
      const text = readFileSync(join(import.meta.dirname, file), 'utf8');
      for (const rule of text.match(/[^{}]*\.tbl-stake[^{}]*\{[^}]*\}/g) ?? []) expect(rule, `${file}: ${rule}`).not.toMatch(/\n\s*height:(?![^;]*--stake-h)/);
    }
    // Brand tokens, the same in both themes; the ink chip's edge and spots are lime, the off-white chip's edge heavier.
    expect(css).toMatch(/\.tbl-chip \{\s*--chip-ink: var\(--color-primary-contrast\);\s*--chip-lime: var\(--color-primary\);\s*--chip-lilac: var\(--color-secondary\);\s*--chip-white: var\(--color-offwhite\);/);
    expect(css).toMatch(/\.tbl-chip--ink \{\s*--chip-fill: var\(--chip-ink\);\s*--chip-edge: var\(--chip-lime\);\s*--chip-spot: var\(--chip-lime\);/);
    expect(css).toMatch(/\.tbl-chip--white \{\s*--chip-edge-w: 2\.4;/);
    const tokens = readFileSync(join(import.meta.dirname, '../styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--color-offwhite: #f5f6ef;/);
    expect(tokens.match(/--color-offwhite/g)).toHaveLength(1);
    // Six edge spots (a dashed ring) only on the stage and a wide full tile: under 16px they are noise.
    expect(css).toMatch(/\.tbl-chip__spots \{[^}]*stroke-dasharray: 4\.4 4\.4;/);
    expect(css).toMatch(/\.tbl-tile \.tbl-chip__spots \{\s*display: none;/);
    // On a tile the ink chip's lime edge is as heavy as the off-white chip's, so it reads at 1x on a dark panel.
    expect(css).toMatch(/\.tbl-tile \.tbl-chip--ink \{\s*--chip-edge-w: 2\.4;/);
    expect(css).toMatch(/@container tile \(min-width: 200px\) \{\s*\.tbl-tile--full \.tbl-chip__spots \{\s*display: inline;/);
    // A plus in the display face, as big as the figure and as bold, when more chips are owed than drawn.
    expect(css).toMatch(/\.tbl-stake__more \{[^}]*font-family: var\(--font-display\);\s*font-size: 1em;\s*font-weight: 800;[^}]*color: var\(--color-warning-text\);/);
    // A compact tile, at every width, shortens the figure beside two chips and a five-digit stack, so the stack and the bet keep to one line.
    // The narrow compact layout (the stack and the pill across the tile's whole width, under the name) reaches 199px: beside the avatar, "9,010 chips" and two chips with a plus and "990" overran a desktop tile up to 184px wide.
    const narrowStart = css.search(/@container tile \(max-width: 199px\) \{\s*\.tbl-tile--compact \{/);
    expect(narrowStart).toBeGreaterThan(0);
    expect(css.slice(narrowStart)).toMatch(/^@container tile \(max-width: 199px\) \{\s*\.tbl-tile--compact \{[^}]*grid-template-areas: 'face name total' 'meta meta meta';/);
    expect(css).not.toMatch(/@container tile \(max-width: 155px\)/);
    const compact = css.slice(css.indexOf('.tbl-tile--compact {'), narrowStart);
    expect(compact).toMatch(/\n\.tbl-tile--compact \.tbl-tile__bet \.tbl-stake--wide \.tbl-figure__full,\s*\.tbl-tile--compact \.tbl-tile__chips\[data-long\] \.tbl-figure__full \{\s*display: none;/);
    expect(compact).toMatch(/\n\.tbl-tile--compact \.tbl-tile__bet \.tbl-stake--wide \.tbl-figure__short,\s*\.tbl-tile--compact \.tbl-tile__chips\[data-long\] \.tbl-figure__short \{\s*display: inline;/);
    // The stacked layout (a short narrow tile) now reaches 149px, so a 390px phone's three-across tiles and a desktop's 128px to 145px compact tiles use it.
    // The bet pill has its line to itself and the total sits by the stack: side by side, the pill ran under the total on a 66px phone tile and lost its figure.
    const stacked = css.slice(css.indexOf('@container tile (max-width: 149px) and (max-height: 70px) {'), css.indexOf('@container tile (max-height: 46px) {'));
    expect(stacked).toMatch(/^@container tile \(max-width: 149px\) and \(max-height: 70px\) \{\s*\.tbl-tile--compact \{[^}]*grid-template-areas: 'face name name' 'chips chips total' 'bet bet bet';/);
    expect(css).not.toContain("'bet bet total'");
    // The total no taller than the stack's line, so the three lines take no more height than before; the stacked layout forces no short figure of its own (the compact rules above shorten a wide or four-digit pill).
    expect(stacked).toMatch(/\.tbl-tile--compact \.tbl-tile__total \.tbl-pill \{\s*height: 13px;/);
    // With no total on its line (the bets going down) the stack takes the whole line, total's column and all: "150k chips" lost 4px to the
    // empty column on a 66px tile and ended in an ellipsis.
    expect(stacked).toMatch(/\.tbl-tile--compact:not\(:has\(> \.tbl-tile__total\)\) \.tbl-tile__chips \{\s*grid-column: 1 \/ -1;\s*\}/);
    expect(stacked).not.toContain('.tbl-tile__bet .tbl-figure__full');
    expect(css).not.toMatch(/@container tile \(max-width: 139px\) and \(max-height: 70px\)/);
    expect(css).not.toMatch(/@container tile \(max-width: 112px\) and \(max-height: 70px\)/);
    expect(css).not.toMatch(/@container tile \(max-width: 124px\) and \(max-height: 70px\)/);
    // Under 200px a four-digit stake reads short too, so the stack and the pill keep to one line inside the turn ring.
    const narrow = css.slice(narrowStart, css.indexOf('@container tile (max-width: 112px)', narrowStart));
    expect(narrow).toMatch(/\.tbl-tile--compact \.tbl-tile__bet \.tbl-stake\[data-long\] \.tbl-figure__full \{\s*display: none;/);
    expect(narrow).toMatch(/\.tbl-tile--compact \.tbl-tile__bet \.tbl-stake\[data-long\] \.tbl-figure__short \{\s*display: inline;/);
    // A narrow full tile shares the pill's row with the seat line: two chips and a short four-digit figure under 140px, one chip under 113px, the spare plus only when a drawn chip is hidden.
    const narrowFull = css.slice(css.indexOf('@container tile (max-width: 139px) {'), css.indexOf('/* Compact (5 to 9)'));
    expect(narrowFull).toMatch(/\.tbl-tile--full \.tbl-stake \{\s*gap: 0\.2em;\s*padding: 0 0\.3em 0 0\.25em;/);
    expect(narrowFull).toMatch(/\.tbl-tile--full \.tbl-stake__chip:nth-child\(n \+ 3\) \{\s*display: none;/);
    expect(narrowFull).toMatch(/\.tbl-tile--full \.tbl-stake__chips\[data-count='3'\] \+ \.tbl-stake__more--spare \{\s*display: inline;/);
    expect(narrowFull).toMatch(/\.tbl-tile--full \.tbl-tile__bet \.tbl-stake\[data-long\] \.tbl-figure__short \{\s*display: inline;/);
    expect(narrowFull).toMatch(/@container tile \(max-width: 112px\) \{\s*\.tbl-tile--full \.tbl-stake__chip \+ \.tbl-stake__chip \{\s*display: none;\s*\}\s*\.tbl-tile--full \.tbl-stake__chips\[data-count='2'\] \+ \.tbl-stake__more--spare \{\s*display: inline;/);
    // A full tile 200px to 239px wide keeps the stack and the pill on one line: a wide pill (two chips, or a plus) reads a four-digit figure short
    // there, as three chips, a plus and "12,000" beside "88,000 chips" once dropped the pill to a line of its own and laid the name over the stack.
    // It keeps its three chips (a spare plus in place of the third would be no narrower), and a pill of one chip keeps its figure in full.
    const midFull = css.slice(css.indexOf('@container tile (min-width: 200px) and (max-width: 239px) {'));
    const midBlock = midFull.slice(0, midFull.indexOf('\n}'));
    expect(midBlock).toMatch(/^@container tile \(min-width: 200px\) and \(max-width: 239px\) \{\s*\.tbl-tile--full \.tbl-tile__bet \.tbl-stake--wide\[data-long\] \.tbl-figure__full \{\s*display: none;\s*\}\s*\.tbl-tile--full \.tbl-tile__bet \.tbl-stake--wide\[data-long\] \.tbl-figure__short \{\s*display: inline;\s*\}\s*$/);
  });
});

describe('a hand', () => {
  const card = (rank: string) => createElement('span', { key: rank, className: 'playing-card', 'data-rank': rank });

  it('fans its cards in steps with the total over the top right corner, and keeps one height however many cards', () => {
    const out = html(createElement(HandFan, { tone: 'active', total: '15', totalTestId: 'total', label: 'Hand 1: 15', testId: 'hand', children: [card('8'), card('7')] }));
    expect(out).toMatch(/^<div role="group" class="tbl-hand tbl-hand--big tbl-hand--active" style="--fan:2" aria-label="Hand 1: 15" data-testid="hand" data-tone="active">/);
    expect(out).toMatch(/<div class="tbl-hand__head"><span class="tbl-pill tbl-pill--active" data-testid="total">15<\/span><\/div><div class="tbl-fan">/);
    expect(out).toContain('<span class="tbl-fan__card" style="--i:0"><span class="playing-card" data-rank="8">');
    expect(out).toContain('<span class="tbl-fan__card" style="--i:1">');
    // Five cards: the fan says so (its step shrinks past four), and a pill comes only with a total.
    const five = html(createElement(HandFan, { tone: 'neutral', total: null, label: 'Hand', testId: 'hand', children: ['2', '3', '4', '5', '6'].map(card) }));
    expect(five).toContain('style="--fan:5"');
    expect(five).not.toContain('tbl-pill');
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    expect(css).toMatch(/\.tbl-fan__card \+ \.tbl-fan__card \{\s*margin-left: calc\(var\(--fan-dx\) - var\(--tbl-w\)\);/);
    expect(css).toMatch(/--fan-dx: calc\(var\(--tbl-w\) \* var\(--fan-step\)\);/);
    expect(css).toMatch(/:root \{\s*--fan-step: 0\.44;/);
  });

  it('shows how it ended: every card outlined and the pill in the outcome colour, the word beside the pill', () => {
    const won = html(createElement(HandFan, { tone: 'win', total: '20', label: 'Hand', testId: 'hand', flag: createElement(OutcomeFlag, { tone: 'win', word: 'Win', extra: '+20', testId: 'outcome' }), children: [card('K'), card('Q')] }));
    expect(won).toContain('tbl-hand--win');
    expect(won).toContain('<span class="tbl-flag tbl-flag--win"><span data-testid="outcome">Win</span> +20</span><span class="tbl-pill tbl-pill--win">20</span>');
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    for (const tone of ['win', 'blackjack', 'loss', 'bust', 'push']) expect(css).toContain(`.tbl-hand--${tone} .tbl-fan .playing-card`);
    expect(css).toMatch(/\.tbl-hand--win \{\s*--hand-outcome: var\(--color-primary-text\);/);
    expect(css).toMatch(/\.tbl-hand--bust \{\s*--hand-outcome: var\(--color-danger\);/);
    // The chip beside the pill is a flex box, which drops the space before "+20": a gap keeps "Win +20" apart.
    expect(css).toMatch(/\.tbl-hand__head \.tbl-flag \{\s*display: inline-flex;\s*align-items: center;\s*\/\*[^*]*\*\/\s*gap: 0\.3em;/);
  });

  it('a calm table: the deck tucked in its corner, the discards past the other one', () => {
    expect(html(createElement(Deck, { name: 'shoe', testId: 'shoe', corner: true }))).toMatch(/^<div class="tbl-deck tbl-deck--corner" data-testid="shoe"/);
    expect(html(createElement(DiscardCorner, { discarded: 12 }))).toBe('<span class="tbl-discard-corner" data-testid="discard-tray" data-discarded="12" data-table-discard="" aria-hidden="true"></span>');
    // Every card back in a stack is the boredgames back.
    expect(html(createElement(Deck, { name: 'shoe', testId: 'shoe' }))).toContain('<span class="tbl-stack__card" style="transform:translate(0px, 0px)"><span class="playing-card__back"></span></span>');
  });
});

describe('copy', () => {
  it('never shows an em dash in the kit or its stylesheet', () => {
    const files = [...readdirSync(import.meta.dirname).filter((n) => /\.tsx?$/.test(n) && !n.endsWith('.test.ts')).map((n) => join(import.meta.dirname, n)), join(import.meta.dirname, '../styles/table.css'), join(import.meta.dirname, '../lib/hotkeys.ts')];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, 'utf8').includes('\u2014'), file).toBe(false);
  });
});
