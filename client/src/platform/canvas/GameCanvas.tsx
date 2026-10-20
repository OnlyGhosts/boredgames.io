import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/platform/canvas';
import { PHONE_QUERY, matchesMedia, prefersReducedMotion } from '../lib/media';
import { drawingBounds, easeView, fitView, sameView, wholeCanvasView, type Box, type View } from './fit';
import { CanvasRenderer } from './renderer';
import type { CanvasSession } from './session';
import { useDrawing, type DrawingSettings } from './useDrawing';
import './canvas.css';

interface Props {
  session: CanvasSession;
  canDraw: boolean;
  settings: DrawingSettings;
  /** Overlays rendered on top of the canvas (choosing, turn end, captions). */
  children?: ReactNode;
  /** Rendered directly under the canvas and counted in the fit calculation (the toolbar). */
  footer?: ReactNode;
  /**
   * A selector for things laid over the surface (a caption, a clock): wherever they overlap it,
   * a watcher's fitted drawing keeps clear of them.
   */
  avoid?: string;
}

interface Frame {
  width: number;
  height: number;
}

const ASPECT = CANVAS_WIDTH / CANVAS_HEIGHT;

/**
 * The stage's height only counts when the layout gives it a definite one (a bounded flex item,
 * as on desktop and in the phone app layout). A layout that lets the stage grow with its content
 * opts out with `--canvas-fit: width`, otherwise fitting by height would feed back on itself.
 */
function stageHasDefiniteHeight(stage: HTMLElement): boolean {
  return getComputedStyle(stage).getPropertyValue('--canvas-fit').trim() !== 'width';
}

function sameFrame(a: Frame | null, b: Frame): boolean {
  return a !== null && a.width === b.width && a.height === b.height;
}

interface Fit {
  /** The surface (the canvas element) in CSS pixels; null until measured. */
  surface: Frame | null;
  /** The view on screen, and the one it eases toward. */
  shown: View | null;
  target: View | null;
  /** Whether the last fit had a drawing to fit (a first drawing, or a blank, jumps rather than eases). */
  hadDrawing: boolean;
  /** Whether the last fit was the drawer's. */
  drawing: boolean;
  avoid: Box[];
  avoidKey: string;
  raf: number;
  last: number;
}

/**
 * Hosts the logical 800x600 canvas and keeps the renderer in sync with the session: remote ops
 * stream in through the session, structural changes (undo / clear / resync / rejoin) bump
 * `canvasEpoch` and trigger a full replay.
 *
 * The drawer gets the whole canvas at 4:3, as large as the stage allows, and it never moves under
 * the pen. Everyone else gets paper filling the whole stage, with the drawing so far fitted to it
 * (fitView): zoomed in up to MAX_FIT_ZOOM past the whole canvas, easing between fits.
 */
export function GameCanvas({ session, canDraw, settings, children, footer, avoid }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  // Phone layout: the toolbar spans the stage instead of the canvas, so its height never depends
  // on the canvas width (which would feed back into the by-height fit).
  const [fullWidthGroup, setFullWidthGroup] = useState(() => matchesMedia(PHONE_QUERY));
  const epoch = session.store((s) => s.canvasEpoch);
  const fitRef = useRef<Fit>({ surface: null, shown: null, target: null, hadDrawing: false, drawing: canDraw, avoid: [], avoidKey: '', raf: 0, last: 0 });
  const propsRef = useRef({ session, canDraw, avoid });
  useLayoutEffect(() => {
    propsRef.current = { session, canDraw, avoid };
  });

  /** Fits the view to the drawing (or the drawer's whole canvas); `jump` skips the easing, `force` redraws even when nothing moved. */
  const refitRef = useRef((jump = false, force = false): void => {
    const fit = fitRef.current;
    const renderer = rendererRef.current;
    if (!renderer || !fit.surface) return;
    const actions = propsRef.current.session.store.getState().canvas;
    const { width, height } = fit.surface;
    const drawing = propsRef.current.canDraw;
    const bounds = drawing ? null : drawingBounds(actions, (a) => renderer.fillBox(a));
    const target = drawing ? wholeCanvasView(width, height) : fitView({ width, height, bounds, avoid: fit.avoid });
    const ease = !jump && fit.shown !== null && fit.hadDrawing && bounds !== null && fit.drawing === drawing && !prefersReducedMotion();
    fit.hadDrawing = bounds !== null;
    fit.drawing = drawing;
    fit.target = target;
    if (ease && fit.shown) {
      if (!fit.raf && !sameView(fit.shown, target)) {
        fit.last = 0;
        fit.raf = requestAnimationFrame(stepRef.current);
      }
      return;
    }
    if (fit.raf) cancelAnimationFrame(fit.raf);
    fit.raf = 0;
    const moved = !fit.shown || !sameView(fit.shown, target);
    fit.shown = target;
    if (moved || force) {
      renderer.setView(target);
      renderer.redraw(actions);
    }
  });

  /** One frame of the easing: the whole picture is redrawn at the in-between view. */
  const stepRef = useRef((now: number): void => {
    const fit = fitRef.current;
    const renderer = rendererRef.current;
    fit.raf = 0;
    if (!renderer || !fit.shown || !fit.target) return;
    const dt = fit.last ? Math.min(100, now - fit.last) : 16;
    fit.last = now;
    const next = easeView(fit.shown, fit.target, dt);
    const done = sameView(next, fit.target);
    fit.shown = done ? fit.target : next;
    renderer.setView(fit.shown);
    renderer.redraw(propsRef.current.session.store.getState().canvas);
    if (!done) fit.raf = requestAnimationFrame(stepRef.current);
  });

  /** Measures the surface and what lies over it; a new size reallocates the bitmap and fits at once. */
  const syncRef = useRef((): void => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    const fit = fitRef.current;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const boxes: Box[] = [];
    const selector = propsRef.current.avoid;
    if (selector) {
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.right <= rect.left || r.left >= rect.right || r.bottom <= rect.top || r.top >= rect.bottom) continue;
        boxes.push({ left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top });
      }
    }
    const avoidKey = boxes.map((b) => [b.left, b.top, b.right, b.bottom].map(Math.round).join(',')).join(';');
    const sized = !fit.surface || fit.surface.width !== rect.width || fit.surface.height !== rect.height;
    fit.surface = { width: rect.width, height: rect.height };
    const reset = renderer.resize(window.devicePixelRatio, rect.width, rect.height);
    const moved = avoidKey !== fit.avoidKey;
    fit.avoid = boxes;
    fit.avoidKey = avoidKey;
    if (reset || sized) refitRef.current(true, true);
    else if (moved || fit.drawing !== propsRef.current.canDraw) refitRef.current(fit.drawing !== propsRef.current.canDraw);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;
    renderer.replayAll(session.store.getState().canvas);
    // The session folded the ops into its history before publishing them; the list lets fills be cached.
    const unsubscribe = session.subscribe((ops) => {
      renderer.applyOps(ops, session.store.getState().canvas);
      refitRef.current();
    });
    const fit = fitRef.current;
    fit.surface = null;
    fit.shown = null;
    syncRef.current();
    return () => {
      unsubscribe();
      if (fit.raf) cancelAnimationFrame(fit.raf);
      fit.raf = 0;
      rendererRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    rendererRef.current?.replayAll(session.store.getState().canvas);
    refitRef.current();
  }, [session, epoch]);

  // After every render: the frame may have a new size, a caption may have come or gone.
  useLayoutEffect(() => {
    syncRef.current();
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const phone = window.matchMedia(PHONE_QUERY);
    const update = () => {
      setFullWidthGroup(phone.matches);
      const rect = stage.getBoundingClientRect();
      let width = rect.width;
      let next: Frame | null = null;
      // Fit by both width and height (the toolbar under the canvas counts) whenever the stage has
      // a definite height; otherwise the width rules and the stage grows with the content.
      if (rect.height > 1 && stageHasDefiniteHeight(stage)) {
        if (!canDraw) {
          // Watching: the paper takes the whole stage, whatever its shape; the drawing fits inside.
          next = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
        } else {
          const gap = groupRef.current ? parseFloat(getComputedStyle(groupRef.current).rowGap) || 0 : 0;
          const footerHeight = footerRef.current ? footerRef.current.offsetHeight + gap : 0;
          width = Math.min(rect.width, Math.max(0, rect.height - footerHeight) * ASPECT);
        }
      }
      if (!next && width > 0) next = { width: Math.floor(width), height: Math.floor(width / ASPECT) };
      if (next && next.width > 0 && next.height > 0) {
        const frameNext = next;
        setFrame((prev) => (sameFrame(prev, frameNext) ? prev : frameNext));
      }
      syncRef.current();
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(stage);
    if (footerRef.current) observer?.observe(footerRef.current);
    window.addEventListener('resize', update);
    phone.addEventListener('change', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      phone.removeEventListener('change', update);
    };
  }, [session, canDraw, footer !== undefined]);

  useDrawing({ session, canvasRef, rendererRef, enabled: canDraw, settings });

  return (
    <div className="canvas-stage" ref={stageRef}>
      <div className="canvas-group" ref={groupRef} style={frame && !fullWidthGroup ? { width: frame.width } : undefined}>
        <div
          className={`canvas-frame${canDraw ? ` canvas-frame--drawing canvas-frame--tool-${settings.tool}` : ''}`}
          style={frame ? { width: frame.width, height: frame.height } : undefined}
        >
          <canvas
            ref={canvasRef}
            className="game-canvas"
            data-testid="canvas"
            role="img"
            aria-label={canDraw ? 'Drawing canvas, draw here' : 'Drawing canvas'}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
          {children}
        </div>
        {footer !== undefined && (
          <div className="canvas-group__footer" ref={footerRef}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
