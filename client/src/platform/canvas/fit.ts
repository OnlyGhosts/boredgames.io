import { CANVAS_HEIGHT, CANVAS_WIDTH, type CanvasAction } from '@shared/platform/canvas';

/**
 * Where the logical 800x600 picture sits on a surface: a logical point (x, y) is drawn at
 * (view.x + x * view.scale, view.y + y * view.scale) CSS pixels from the surface's top left.
 * Line widths are logical too, so a zoomed drawing looks the same, just bigger.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** A box in logical canvas units (the drawing) or in surface CSS pixels (what to keep clear). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type FillAction = Extract<CanvasAction, { kind: 'fill' }>;

/**
 * How far a viewer's view may zoom in past the whole canvas: a first dot or a short line stays a
 * dot or a short line, while a drawing in a quarter of the canvas fills most of the surface.
 */
export const MAX_FIT_ZOOM = 2.5;

/** The easing's time constant: about 95% of a change is done after three of these (about 0.4 s). */
export const FIT_EASE_MS = 140;

/** The scale that shows the whole canvas on a surface (the floor of every fit). */
export function wholeCanvasScale(width: number, height: number): number {
  return Math.max(0, Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT));
}

/** The whole canvas, as large as the surface allows and centred: the drawer's view, and an empty canvas's. */
export function wholeCanvasView(width: number, height: number): View {
  const scale = wholeCanvasScale(width, height);
  return { scale, x: (width - CANVAS_WIDTH * scale) / 2, y: (height - CANVAS_HEIGHT * scale) / 2 };
}

/** The margin left around a fitted drawing: small, and a little larger on a larger surface. */
export function fitMargin(width: number, height: number): number {
  return Math.round(Math.min(20, Math.max(6, Math.min(width, height) * 0.04)));
}

const WHOLE: Box = { left: 0, top: 0, right: CANVAS_WIDTH, bottom: CANVAS_HEIGHT };

/**
 * The logical box holding everything drawn so far, or null for a blank canvas. A stroke counts
 * its line's width; an eraser stroke only ever whitens what is already counted, so it adds
 * nothing. A fill counts the area it painted: `fillBox` reports it (null when it painted nothing);
 * a fill it cannot report counts as the whole canvas, which is what a background fill is.
 */
export function drawingBounds(actions: readonly CanvasAction[], fillBox?: (action: FillAction) => Box | null | undefined): Box | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const action of actions) {
    if (action.kind === 'fill') {
      const box = fillBox ? fillBox(action) : undefined;
      if (box === null) continue;
      const b = box ?? WHOLE;
      left = Math.min(left, b.left);
      top = Math.min(top, b.top);
      right = Math.max(right, b.right);
      bottom = Math.max(bottom, b.bottom);
      continue;
    }
    if (action.tool === 'eraser') continue;
    const r = action.size / 2;
    const pts = action.points;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      if (x - r < left) left = x - r;
      if (x + r > right) right = x + r;
      if (y - r < top) top = y - r;
      if (y + r > bottom) bottom = y + r;
    }
  }
  if (!(right > left && bottom > top)) return null;
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    right: Math.min(CANVAS_WIDTH, right),
    bottom: Math.min(CANVAS_HEIGHT, bottom),
  };
}

export interface FitOptions {
  /** The surface's size in CSS pixels. */
  width: number;
  height: number;
  /** What has been drawn (drawingBounds); null shows the whole canvas. */
  bounds: Box | null;
  /** Boxes on the surface (CSS pixels) the drawing keeps clear of: a caption, a clock. */
  avoid?: readonly Box[];
  /** The margin around the drawing; fitMargin by default. */
  margin?: number;
  /** The zoom cap, as a multiple of the whole-canvas scale; MAX_FIT_ZOOM by default. */
  maxZoom?: number;
}

const GAP = 4;

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * The view that shows a drawing as large as the surface allows: its box scaled to fill the surface
 * (less a small margin), keeping its proportions, and centred. Never smaller than the whole canvas
 * fitted, never more than `maxZoom` times that. Boxes to avoid push the drawing aside: it fits
 * either between the ones above and below it or between the ones beside it, whichever leaves it
 * larger, and keeps to the middle when it is small enough to clear them there anyway.
 */
export function fitView({ width, height, bounds, avoid = [], margin = fitMargin(width, height), maxZoom = MAX_FIT_ZOOM }: FitOptions): View {
  const floor = wholeCanvasScale(width, height);
  if (!bounds || floor <= 0) return wholeCanvasView(width, height);
  const bw = Math.max(1, bounds.right - bounds.left);
  const bh = Math.max(1, bounds.bottom - bounds.top);
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;

  // How far the boxes to avoid reach in from each edge (each counts toward its nearest edges).
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  const clear: Box[] = [];
  for (const a of avoid) {
    const b = { left: Math.max(0, a.left), top: Math.max(0, a.top), right: Math.min(width, a.right), bottom: Math.min(height, a.bottom) };
    if (b.right <= b.left || b.bottom <= b.top) continue;
    clear.push(b);
    if ((b.top + b.bottom) / 2 < height / 2) top = Math.max(top, b.bottom + GAP);
    else bottom = Math.max(bottom, height - b.top + GAP);
    if ((b.left + b.right) / 2 < width / 2) left = Math.max(left, b.right + GAP);
    else right = Math.max(right, width - b.left + GAP);
  }

  const candidates: Box[] = [
    { left: margin, right: width - margin, top: Math.max(margin, top), bottom: height - Math.max(margin, bottom) },
    { left: Math.max(margin, left), right: width - Math.max(margin, right), top: margin, bottom: height - margin },
  ];
  let best = candidates[0];
  let fit = -Infinity;
  for (const box of candidates) {
    const s = Math.min((box.right - box.left) / bw, (box.bottom - box.top) / bh);
    if (s > fit) {
      fit = s;
      best = box;
    }
  }
  const scale = Math.min(floor * maxZoom, Math.max(floor, fit));

  const place = (box: Box): View => ({
    scale,
    x: (box.left + box.right) / 2 - cx * scale,
    y: (box.top + box.bottom) / 2 - cy * scale,
  });
  const middle = place({ left: 0, top: 0, right: width, bottom: height });
  const drawn: Box = {
    left: middle.x + bounds.left * scale,
    top: middle.y + bounds.top * scale,
    right: middle.x + bounds.right * scale,
    bottom: middle.y + bounds.bottom * scale,
  };
  return clear.some((b) => overlaps(drawn, b)) ? place(best) : middle;
}

/** True when two views draw the same picture to within half a pixel. */
export function sameView(a: View, b: View): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.scale - b.scale) * CANVAS_WIDTH < 0.5;
}

/**
 * One frame of easing from `from` toward `to`, `dt` milliseconds after the last: an exponential
 * approach, so a target that moves mid-way (the drawing keeps growing) is followed without a jump.
 */
export function easeView(from: View, to: View, dt: number, tau = FIT_EASE_MS): View {
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return {
    scale: from.scale + (to.scale - from.scale) * k,
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
  };
}

/** The bounds of a fill's painted spans ([y, x0, x1) triples), or null when it painted nothing. */
export function spansBox(spans: readonly number[]): Box | null {
  if (spans.length < 3) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i + 2 < spans.length; i += 3) {
    const y = spans[i];
    if (y < top) top = y;
    if (y + 1 > bottom) bottom = y + 1;
    if (spans[i + 1] < left) left = spans[i + 1];
    if (spans[i + 2] > right) right = spans[i + 2];
  }
  return { left, top, right, bottom };
}
