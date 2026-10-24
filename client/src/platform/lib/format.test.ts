import { describe, expect, it } from 'vitest';
import { shortChips } from './format';

describe('shortChips', () => {
  it('shortens big stacks with k, M, B and T, as starting chips have no real top', () => {
    expect(shortChips(950)).toBe('950');
    expect(shortChips(1200)).toBe('1.2k');
    expect(shortChips(15_000)).toBe('15k');
    expect(shortChips(2_500_000)).toBe('2.5M');
    expect(shortChips(3_000_000_000)).toBe('3B');
    expect(shortChips(1_000_000_000_000)).toBe('1T');
  });
});
