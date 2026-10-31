import { describe, expect, it } from 'vitest';
import { isDay, shiftDay, ukDay } from './admin.js';

describe('UK days', () => {
  it('accepts only a real calendar date written YYYY-MM-DD', () => {
    for (const good of ['2026-10-29', '2024-02-29', '1999-12-31']) expect(isDay(good), good).toBe(true);
    for (const bad of ['2026-10-1', '2026-1-10', '26-10-29', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-29T00:00', ' 2026-10-29', '2026/10/29', 'today', ''])
      expect(isDay(bad), bad).toBe(false);
  });

  it('steps a day at a time over months, years and both clock changes', () => {
    expect(shiftDay('2026-10-29', -1)).toBe('2026-10-28');
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDay('2026-10-25', 1)).toBe('2026-10-26');
    expect(shiftDay('2026-03-30', -1)).toBe('2026-03-29');
    expect(shiftDay('2026-10-28', -6)).toBe('2026-10-22');
  });

  it('reads the date in London, GMT or BST', () => {
    expect(ukDay(Date.UTC(2026, 9, 24, 23, 30))).toBe('2026-10-25');
    expect(ukDay(Date.UTC(2026, 9, 25, 23, 30))).toBe('2026-10-25');
  });
});
