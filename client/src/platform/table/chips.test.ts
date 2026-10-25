/** The chips on screen: a stack holds its pre-settle count until the settle's outcome shows on the timeline. */
import { describe, expect, it } from 'vitest';
import { OUTCOMES, chipsOnScreen, chipsValue, snapTimeline, tween } from './timeline';

describe('chipsOnScreen', () => {
  it('holds back what a settle paid until the outcomes show', () => {
    const tl = snapTimeline<null>(1, 0);
    tl.marks[OUTCOMES] = 1000;
    expect(chipsOnScreen(tl, 'a', 1150, 500, 150)).toBe(1000);
    expect(chipsOnScreen(tl, 'a', 1150, 999, 150)).toBe(1000);
    expect(chipsOnScreen(tl, 'a', 1150, 1000, 150)).toBe(1150);
  });

  it('shows the truth with nothing owed or no reveal planned', () => {
    const tl = snapTimeline<null>(1, 0);
    expect(chipsOnScreen(tl, 'a', 900, 0, 150)).toBe(900);
    tl.marks[OUTCOMES] = 1000;
    expect(chipsOnScreen(tl, 'a', 900, 10)).toBe(900);
  });

  it('follows a planned stack tween', () => {
    const tl = snapTimeline<null>(1, 0);
    tween(tl, chipsValue('a'), 500, 2000, 850);
    expect(chipsOnScreen(tl, 'a', 850, 1000)).toBe(500);
    expect(chipsOnScreen(tl, 'a', 850, 2000)).toBe(850);
  });
});
