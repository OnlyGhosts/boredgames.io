import { describe, expect, it } from 'vitest';
import {
  isGameSlugPath,
  isRoomPath,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  extractRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from './roomCode.js';

describe('room codes', () => {
  it('alphabet has no look-alike glyphs', () => {
    for (const ch of 'ILO01') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('generates valid codes', () => {
    for (let i = 0; i < 500; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(c)).toBe(true);
    }
  });

  it('is deterministic with an injected rng', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAA');
    expect(generateRoomCode(() => 0.9999)).toBe('9999');
  });

  it('normalizes user input', () => {
    expect(normalizeRoomCode(' ab-c2 ')).toBe('ABC2');
    expect(normalizeRoomCode('abcd2')).toBe('ABCD');
    expect(isValidRoomCode('ABCD')).toBe(true);
    expect(isValidRoomCode('ABCO')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
  });

  it('extracts codes from share links and raw text', () => {
    expect(extractRoomCode('https://play.example.com/XK4P')).toBe('XK4P');
    expect(extractRoomCode('https://play.example.com/?room=xk4p')).toBe('XK4P');
    expect(extractRoomCode('xk4p')).toBe('XK4P');
    expect(extractRoomCode('hello')).toBeNull();
    expect(extractRoomCode('')).toBeNull();
  });
});

describe('isGameSlugPath', () => {
  it('knows the old per-game landing pages, any case, current or former slug', () => {
    for (const path of ['/scribble', '/SPYGAME', '/skribble', '/template/']) expect(isGameSlugPath(path), path).toBe(true);
    for (const path of ['/', '/hangman', '/scribble/MRAN', '/MRAN', '/nope/path']) expect(isGameSlugPath(path), path).toBe(false);
  });
});

describe('isRoomPath', () => {
  it('knows a room link by its shape: a game slug (current or former, any case) and a four-character code, or the bare code', () => {
    for (const path of ['/scribble/MRAN', '/SPYGAME/mran', '/Scribble/MRAN', '/skribble/AB2K', '/template/AB2K', '/MRAN', '/mran', '/scribble/MRAN/']) {
      expect(isRoomPath(path), path).toBe(true);
    }
  });
  it('leaves everything else to the 404 page', () => {
    for (const path of ['/', '/scribble', '/nope/path', '/hangman', '/battleships/MRAN', '/scribble/MRAN/extra', '/MRANX', '/MR-N', '/scribble/MR', '/api/rooms/MRAN']) {
      expect(isRoomPath(path), path).toBe(false);
    }
  });
});
