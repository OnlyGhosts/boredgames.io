import { isDay, shiftDay, ukDay, type Range } from '@shared/platform/admin';
import { dayText } from './format';

/**
 * What the Analytics page shows: one UK day, or the last 7 or 30 days. A null day is today, and
 * stays today when London's date moves on at midnight.
 */
export type Span = { day: string | null } | { range: '7d' | '30d' };

export const isDaySpan = (span: Span): span is { day: string | null } => 'day' in span;

/** The day a day span shows, or null for a range. */
export function spanDay(span: Span, now: number): string | null {
  return isDaySpan(span) ? (span.day ?? ukDay(now)) : null;
}

/** A day as a span: today is null, so the page keeps showing today after midnight. */
export function daySpan(day: string, now: number): Span {
  return { day: day >= ukDay(now) ? null : day };
}

/** The stepper's label: "Today", "Yesterday", else "Thu 29 Oct" (with the year when it is not this one). */
export function dayLabel(day: string, now: number): string {
  const today = ukDay(now);
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  return day.slice(0, 4) === today.slice(0, 4) ? dayText(day) : `${dayText(day)} ${day.slice(0, 4)}`;
}

/** What the summary API is asked for. */
export function spanQuery(span: Span): Range | { day: string } {
  if (!isDaySpan(span)) return span.range;
  return span.day === null ? 'today' : { day: span.day };
}

/** Whether the span ends today, so its numbers move and want refreshing. */
export const spanHasToday = (span: Span): boolean => !isDaySpan(span) || span.day === null;

/** `#analytics`, `#analytics/7d` or `#analytics/2026-10-29`. */
export function spanHash(span: Span): string {
  if (!isDaySpan(span)) return `#analytics/${span.range}`;
  return span.day === null ? '#analytics' : `#analytics/${span.day}`;
}

/** The span a hash names; anything else (today, a future day, a typo) is today. */
export function spanFromHash(hash: string, now: number): Span {
  const [tab, rest = ''] = hash.replace(/^#/, '').split('/');
  if (tab !== 'analytics') return { day: null };
  if (rest === '7d' || rest === '30d') return { range: rest };
  return isDay(rest) ? daySpan(rest, now) : { day: null };
}
