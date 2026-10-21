import { gameByFormerSlug, gameBySlug } from './games.js';
/**
 * Room codes: 4 characters from an alphabet without look-alike glyphs
 * (no I, L, O, 0, 1) so they are easy to read aloud and type.
 * 31^4 = 923,521 possible codes.
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

const VALID_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** Uppercases and strips anything that is not a letter or digit (spaces, dashes, URL noise). */
export function normalizeRoomCode(input: string): string {
  return (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return VALID_RE.test(code);
}

/** Human readable explanation when a code is syntactically invalid. */
export function roomCodeHint(): string {
  return `Codes are ${ROOM_CODE_LENGTH} characters: letters A–Z (never I, L or O) and digits 2–9.`;
}

/** Extracts a room code from a share link or raw text such as "https://host/ABCD", "?room=ABCD" or "ab-cd". */
export function extractRoomCode(text: string): string | null {
  if (!text) return null;
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('room');
    if (fromQuery) {
      const c = normalizeRoomCode(fromQuery);
      if (isValidRoomCode(c)) return c;
    }
    const seg = url.pathname.split('/').filter(Boolean).pop();
    if (seg) {
      const c = normalizeRoomCode(seg);
      if (isValidRoomCode(c)) return c;
    }
  } catch {
    /* not a URL */
  }
  const c = normalizeRoomCode(text);
  return isValidRoomCode(c) ? c : null;
}

/**
 * Whether a path is a room link the app opens: '/:slug/CODE' with a current or former game slug,
 * or the legacy '/CODE', the code four letters or digits in any case (the app normalises it).
 * The server's fallback and vercel.json's rewrites agree on these shapes: they get the app with a
 * noindex header; any other unknown path is a real 404.
 */
export function isRoomPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const code = segments[segments.length - 1];
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return false;
  if (segments.length === 1) return true;
  if (segments.length !== 2) return false;
  const slug = segments[0].toLowerCase();
  return gameBySlug(slug) !== undefined || gameByFormerSlug(slug) !== undefined;
}

/** A bare game slug, current or former, any case: the old per-game landing pages, sent to the front door. */
export function isGameSlugPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return false;
  const slug = segments[0].toLowerCase();
  return gameBySlug(slug) !== undefined || gameByFormerSlug(slug) !== undefined;
}
