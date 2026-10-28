import { GAME_LIST } from '@shared/platform/games';
import type { LiveRoom } from '@shared/platform/admin';

/** A game's name from its id or its slug (deep links carry slugs). */
export function gameName(idOrSlug: string): string {
  return GAME_LIST.find((g) => g.id === idOrSlug || g.slug === idOrSlug)?.name ?? idOrSlug;
}

/** Where visitors came from, as the Sources table says it. */
export function sourceLabel(source: string, subreddit: string | null): string {
  if (source === 'direct') return 'Direct';
  if (source === 'reddit.com') return subreddit ?? 'Reddit (subreddit not given)';
  if (source.startsWith('ref:')) return `?ref=${source.slice(4)}`;
  return source;
}

/** How long a room has been open: "under 1 min", "12 min", "2 h 5 min" (short enough for a phone's card). */
export function ageText(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'under 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A UK hour of the day as a range: "20:00 to 21:00". */
export function hourText(hour: number): string {
  return `${pad(hour)}:00 to ${pad((hour + 1) % 24)}:00`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Tue 27 Oct" for a YYYY-MM-DD day. */
export function dayText(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T12:00:00Z`)).replace(',', '');
}

/** "27 Oct" for a YYYY-MM-DD day. */
export function shortDayText(day: string): string {
  return SHORT_FORMAT.format(new Date(`${day}T12:00:00Z`));
}

export function phaseText(phase: LiveRoom['phase']): string {
  return phase === 'playing' ? 'Playing' : phase === 'results' ? 'Results' : 'Lobby';
}

export function num(n: number): string {
  return n.toLocaleString('en-GB');
}

/** Joins the last two words with a no-break space, so no line ends on a word alone. */
export function noOrphan(text: string): string {
  return text.replace(/ (\S+)$/, ' $1');
}
