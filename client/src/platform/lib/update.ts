import type { RoomState } from '@shared/platform/protocol';

/**
 * Picking up a new version of the site in a tab left open for hours. The build stamps an id into
 * the bundle and the same id into /version.json (scripts/buildStamp.ts); a different id there means
 * a new version is live, and the tab reloads itself at a safe moment (useAutoUpdate.ts).
 */

/** This page's build, or '' in dev and tests, where nothing is checked. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

export const VERSION_URL = '/version.json';

/** How often a visible tab asks whether a new version is live. */
export const CHECK_EVERY_MS = 5 * 60_000;

/**
 * - `none`: no new version (or none could be read).
 * - `leave`: this tab already reloaded once for that version and still runs the old one (the CDN
 *   lagging behind version.json); it stays as it is rather than reload again.
 * - `wait`: a new version is live, but not now: a field is being typed into, or a game is running.
 * - `reload`: now.
 */
export type UpdateDecision = 'none' | 'leave' | 'wait' | 'reload';

export interface UpdateState {
  /** This page's build id; '' when unstamped. */
  current: string;
  /** The id /version.json gave, or null when the fetch failed or the file could not be read. */
  latest: string | null;
  /** The id this tab last reloaded for (sessionStorage). */
  reloadedFor: string | null;
  /** In a room whose game is running (not its lobby or results). */
  inGame: boolean;
  /** A text field has focus. */
  typing: boolean;
  /** The tab is in the background. */
  hidden: boolean;
}

export function decideUpdate(s: UpdateState): UpdateDecision {
  if (!s.current || !s.latest || s.latest === s.current) return 'none';
  if (s.reloadedFor === s.latest) return 'leave';
  // A half-typed name or guess would be lost: wait until the player leaves the field.
  if (s.typing) return 'wait';
  // In a running game only once nobody is looking; seat recovery brings a reload back, but not mid-turn.
  if (s.inGame && !s.hidden) return 'wait';
  return 'reload';
}

export function isInGame(room: Pick<RoomState, 'phase'> | null): boolean {
  return room !== null && room.phase === 'playing';
}

/** The id in a version.json body, or null for anything else. */
export function parseVersion(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null;
}

/** The live version's id, past every cache; null on any failure (offline, an error page, bad JSON). */
export async function fetchLatest(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<string | null> {
  try {
    const res = await fetchImpl(`${VERSION_URL}?t=${now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseVersion(await res.json());
  } catch {
    return null;
  }
}
