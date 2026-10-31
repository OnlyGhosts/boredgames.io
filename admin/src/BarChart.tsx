import { useEffect, useRef, useState } from 'react';
import { dayText, num, shortDayText } from './format';

interface Props {
  /** Oldest first. */
  days: Array<{ day: string; value: number }>;
  /** What the value counts, for the tooltip and the screen-reader summary ("visitors"). */
  unit: string;
  /** Opens a day: each bar's column is a button ("Show Thu 29 Oct"). */
  onPick(day: string): void;
}

const HEIGHT = 180;
const TOP = 22;
const BOTTOM = 26;
const RADIUS = 4;

/** Rounded at the data end (the top), square on the baseline. */
function barPath(x: number, y: number, w: number, base: number): string {
  const r = Math.min(RADIUS, w / 2, base - y);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/** Which days get a label under the axis: all of a week, about six of a month (the last always). */
function labelled(n: number): Set<number> {
  if (n <= 7) return new Set(Array.from({ length: n }, (_, i) => i));
  const step = Math.ceil(n / 6);
  const out = new Set<number>();
  for (let i = n - 1; i >= 0; i -= step) out.add(i);
  return out;
}

/**
 * One series of bars by day, drawn at the container's own width so text never scales. Each day's
 * column is a real button laid over the drawing, so a bar opens its day by mouse, touch or keyboard.
 */
export function BarChart({ days, unit, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, days.length);
  const max = Math.max(1, ...days.map((d) => d.value));
  const base = HEIGHT - BOTTOM;
  const plot = base - TOP;
  const slot = width / n;
  const barW = Math.max(2, Math.min(48, slot - Math.max(2, slot * 0.3)));
  const peak = days.reduce((best, d, i) => (d.value > (days[best]?.value ?? -1) ? i : best), 0);
  const labels = labelled(days.length);
  const geometry = days.map((d, i) => {
    const h = (d.value / max) * plot;
    return { x: i * slot + (slot - barW) / 2, y: base - h, h };
  });
  const shown = hover;
  const first = days[0];
  const last = days[days.length - 1];
  const summary = first && last ? `${unit} by day from ${dayText(first.day)} to ${dayText(last.day)}, highest ${num(days[peak]?.value ?? 0)} on ${dayText(days[peak]?.day ?? first.day)}` : unit;

  return (
    <div className="chart" ref={wrap} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={summary}>
        <line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} className="chart__axis" />
        {days.map((d, i) => {
          const g = geometry[i]!;
          return (
            <g key={d.day}>
              {g.h > 0 && <path d={barPath(g.x, g.y, barW, base)} className={`chart__bar${shown === i ? ' is-hover' : ''}`} />}
              {labels.has(i) && (
                <text x={i * slot + slot / 2} y={HEIGHT - 8} textAnchor="middle" className="chart__label">
                  {days.length <= 7 ? dayText(d.day).split(' ')[0] : shortDayText(d.day)}
                </text>
              )}
            </g>
          );
        })}
        {shown === null && max > 0 && days[peak] && days[peak].value > 0 && (
          <text x={geometry[peak]!.x + barW / 2} y={geometry[peak]!.y - 6} textAnchor="middle" className="chart__value">
            {num(days[peak].value)}
          </text>
        )}
      </svg>
      {days.map((d, i) => (
        <button
          key={d.day}
          type="button"
          className="chart__hit"
          style={{ left: i * slot, width: slot, height: HEIGHT }}
          aria-label={`Show ${dayText(d.day)}`}
          onClick={() => onPick(d.day)}
          onMouseEnter={() => setHover(i)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          data-testid="bar"
          data-day={d.day}
          data-value={d.value}
        />
      ))}
      {shown !== null && days[shown] && (
        <div className="chart__tip" style={{ left: Math.min(width - 70, Math.max(70, shown * slot + slot / 2)), top: geometry[shown]!.y - 8 }} role="status">
          <strong>{num(days[shown].value)}</strong> {unit}
          <span className="chart__tip-day">{dayText(days[shown].day)}</span>
        </div>
      )}
    </div>
  );
}
