import { describe, expect, it } from 'vitest';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type CanvasAction } from '@shared/platform/canvas';
import { drawingBounds, easeView, fitMargin, fitView, MAX_FIT_ZOOM, sameView, spansBox, wholeCanvasScale, wholeCanvasView, type Box, type View } from './fit';
import { CanvasRenderer } from './renderer';
import { FakeCanvas } from './test/fakeCanvas';

const stroke = (points: number[], size = 6, tool: 'brush' | 'eraser' = 'brush'): CanvasAction => ({ kind: 'stroke', id: 1, tool, color: '#000000', size, points, done: true });
const fill = (x = 10, y = 10): CanvasAction => ({ kind: 'fill', x, y, color: '#ff0000' });

/** Where a logical box lands on the surface under a view. */
const onSurface = (b: Box, v: View): Box => ({ left: v.x + b.left * v.scale, top: v.y + b.top * v.scale, right: v.x + b.right * v.scale, bottom: v.y + b.bottom * v.scale });

describe('the bounds of a drawing', () => {
  it('is null for a blank canvas, and counts each line with its width', () => {
    expect(drawingBounds([])).toBeNull();
    expect(drawingBounds([stroke([100, 200, 300, 250], 10)])).toEqual({ left: 95, top: 195, right: 305, bottom: 255 });
    expect(drawingBounds([stroke([50, 60], 4)])).toEqual({ left: 48, top: 58, right: 52, bottom: 62 });
  });

  it('leaves out eraser strokes, and stays on the canvas', () => {
    expect(drawingBounds([stroke([100, 100, 120, 120]), stroke([0, 0, 790, 590], 40, 'eraser')])).toEqual({ left: 97, top: 97, right: 123, bottom: 123 });
    expect(drawingBounds([stroke([2, 3, CANVAS_WIDTH, CANVAS_HEIGHT], 20)])).toEqual({ left: 0, top: 0, right: CANVAS_WIDTH, bottom: CANVAS_HEIGHT });
  });

  it('counts a fill by the area it painted, the whole canvas when that is not known, nothing when it painted nothing', () => {
    const lines = stroke([300, 300, 320, 320], 2);
    expect(drawingBounds([lines, fill()], () => ({ left: 290, top: 280, right: 340, bottom: 330 }))).toEqual({ left: 290, top: 280, right: 340, bottom: 330 });
    expect(drawingBounds([lines, fill()])).toEqual({ left: 0, top: 0, right: CANVAS_WIDTH, bottom: CANVAS_HEIGHT });
    expect(drawingBounds([lines, fill()], () => null)).toEqual({ left: 299, top: 299, right: 321, bottom: 321 });
  });

  it('reads a fill from its spans ([y, x0, x1) triples)', () => {
    expect(spansBox([])).toBeNull();
    expect(spansBox([5, 10, 20, 6, 8, 30, 7, 12, 14])).toEqual({ left: 8, top: 5, right: 30, bottom: 8 });
  });
});

describe('fitting a drawing to the surface', () => {
  it('shows a blank canvas whole, centred, on any surface', () => {
    expect(fitView({ width: 400, height: 300, bounds: null })).toEqual({ scale: 0.5, x: 0, y: 0 });
    // A tall surface (an upright phone's stage): the canvas spans the width, centred top to bottom.
    expect(fitView({ width: 400, height: 500, bounds: null })).toEqual({ scale: 0.5, x: 0, y: 100 });
    expect(wholeCanvasView(1000, 600)).toEqual({ scale: 1, x: 100, y: 0 });
    expect(wholeCanvasScale(1000, 600)).toBe(1);
  });

  it('scales a drawing up to fill the surface less a small margin, keeping its proportions, and centres it', () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 200 }; // a 2:1 drawing in the top left
    const v = fitView({ width: 400, height: 300, bounds, margin: 10 });
    expect(v.scale).toBeCloseTo(380 / 400); // the width rules: 2:1 on a 4:3 surface
    const shown = onSurface(bounds, v);
    expect(shown.left).toBeCloseTo(10);
    expect(shown.right).toBeCloseTo(390);
    expect((shown.top + shown.bottom) / 2).toBeCloseTo(150); // centred top to bottom
    expect((shown.right - shown.left) / (shown.bottom - shown.top)).toBeCloseTo(2);
  });

  it('never zooms in past the cap, so a first dot or a short line stays small', () => {
    const floor = wholeCanvasScale(400, 300);
    const dot = fitView({ width: 400, height: 300, bounds: drawingBounds([stroke([700, 500], 6)]) });
    expect(dot.scale).toBeCloseTo(floor * MAX_FIT_ZOOM);
    expect(onSurface({ left: 697, top: 497, right: 703, bottom: 503 }, dot).right - onSurface({ left: 697, top: 497, right: 703, bottom: 503 }, dot).left).toBeCloseTo(6 * floor * MAX_FIT_ZOOM);
    // ...and centres it, wherever on the canvas it was drawn.
    expect(dot.x + 700 * dot.scale).toBeCloseTo(200);
    expect(dot.y + 500 * dot.scale).toBeCloseTo(150);
  });

  it('fills most of the surface with a small drawing in a corner', () => {
    const bounds = { left: 20, top: 20, right: 260, bottom: 200 }; // 240x180 of the 800x600 canvas
    const width = 428;
    const height = 321;
    const v = fitView({ width, height, bounds });
    const shown = onSurface(bounds, v);
    expect(shown.right - shown.left).toBeGreaterThan(width * 0.7);
    expect(shown.left).toBeGreaterThanOrEqual(fitMargin(width, height) - 0.01);
    expect(shown.right).toBeLessThanOrEqual(width - fitMargin(width, height) + 0.01);
  });

  it('never shows a drawing smaller than the whole canvas fitted', () => {
    const full = { left: 0, top: 0, right: CANVAS_WIDTH, bottom: CANVAS_HEIGHT };
    expect(fitView({ width: 400, height: 300, bounds: full }).scale).toBeCloseTo(0.5);
    expect(fitView({ width: 400, height: 300, bounds: full, avoid: [{ left: 0, top: 260, right: 150, bottom: 300 }] }).scale).toBeCloseTo(0.5);
  });

  it('keeps the drawing clear of what lies over the surface when it would reach it', () => {
    const caption = { left: 8, top: 262, right: 160, bottom: 292 }; // bottom left
    const clock = { left: 350, top: 6, right: 394, bottom: 50 }; // top right
    const wide = { left: 100, top: 100, right: 500, bottom: 250 }; // 8:3, ruled by the width
    const v = fitView({ width: 400, height: 300, bounds: wide, avoid: [caption, clock], margin: 8 });
    const shown = onSurface(wide, v);
    expect(shown.top).toBeGreaterThanOrEqual(clock.bottom);
    expect(shown.bottom).toBeLessThanOrEqual(caption.top);
    // A small drawing that clears them in the middle stays in the middle.
    const small = { left: 380, top: 280, right: 420, bottom: 320 };
    const m = fitView({ width: 400, height: 300, bounds: small, avoid: [caption, clock] });
    expect(m.x + 400 * m.scale).toBeCloseTo(200);
    expect(m.y + 300 * m.scale).toBeCloseTo(150);
  });
});

describe('easing between fits', () => {
  const from: View = { scale: 1, x: 0, y: 0 };
  const to: View = { scale: 2, x: -100, y: -50 };

  it('moves part of the way each frame and settles on the target', () => {
    expect(easeView(from, to, 0)).toEqual(from);
    const one = easeView(from, to, 16);
    expect(one.scale).toBeGreaterThan(1);
    expect(one.scale).toBeLessThan(1.2);
    let v = from;
    for (let i = 0; i < 90; i++) v = easeView(v, to, 16);
    expect(sameView(v, to)).toBe(true);
  });

  it('follows a target that moves mid-way without a jump', () => {
    const mid = easeView(easeView(from, to, 50), { scale: 3, x: -200, y: -100 }, 16);
    const before = easeView(from, to, 50);
    expect(Math.abs(mid.scale - before.scale)).toBeLessThan(0.3);
  });
});

describe('the renderer on a fitted surface', () => {
  it('sizes its bitmap to the surface and draws every line through the view, so widths scale with the drawing', () => {
    const display = new FakeCanvas(false);
    const renderer = new CanvasRenderer(display as unknown as HTMLCanvasElement, { logical: new FakeCanvas(true), dpr: 2 });
    expect(renderer.resize(2, 300, 500)).toBe(true);
    expect([display.width, display.height]).toEqual([600, 1000]);
    expect(renderer.resize(2, 300, 500)).toBe(false);
    renderer.setView({ scale: 1.5, x: 10, y: 20 });
    const transforms = display.ctx.calls.filter((c) => c.op === 'setTransform');
    expect(transforms[transforms.length - 1].args).toEqual([3, 0, 0, 3, 20, 40]);
    // The pointer maps back through the same view.
    expect(renderer.toLogical(10 + 1.5 * 100, 20 + 1.5 * 40)).toEqual({ x: 100, y: 40 });
    display.ctx.calls.length = 0;
    renderer.redraw([stroke([100, 100, 200, 200], 8)]);
    // Widths stay logical: the transform makes an 8px line 12px wide on screen.
    expect(display.ctx.lineWidth).toBe(8);
    expect(display.ctx.calls.some((c) => c.op === 'lineTo')).toBe(true);
  });

  it('remembers the box each fill painted', () => {
    const logical = new FakeCanvas(true);
    const renderer = new CanvasRenderer(new FakeCanvas(false) as unknown as HTMLCanvasElement, { logical, dpr: 1 });
    // A corner fenced off at x = 30 and y = 20: the fill paints only inside it.
    for (let x = 0; x <= 30; x++) logical.ctx.setPixel(x, 20, '#000000');
    for (let y = 0; y <= 20; y++) logical.ctx.setPixel(30, y, '#000000');
    const action = fill(5, 5) as Extract<CanvasAction, { kind: 'fill' }>;
    expect(renderer.fillBox(action)).toBeUndefined();
    renderer.applyOps([{ k: 'fill', x: 5, y: 5, color: '#ff0000' }], [action]);
    expect(renderer.fillBox(action)).toEqual({ left: 0, top: 0, right: 30, bottom: 20 });
    // A replay repaints the same spans, so the box holds.
    renderer.replayAll([action]);
    expect(renderer.fillBox(action)).toEqual({ left: 0, top: 0, right: 30, bottom: 20 });
  });

  it('keeps big surfaces to a bounded bitmap', () => {
    const display = new FakeCanvas(false);
    const renderer = new CanvasRenderer(display as unknown as HTMLCanvasElement, { logical: new FakeCanvas(true), dpr: 2 });
    renderer.resize(2, 2400, 1800);
    expect(display.width * display.height).toBeLessThanOrEqual(4_000_000 + 4000);
  });
});
