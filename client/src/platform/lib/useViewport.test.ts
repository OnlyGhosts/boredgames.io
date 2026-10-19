import { describe, expect, it } from 'vitest';
import { isTypingTarget, keyboardOpen } from './useViewport';

const el = (tagName: string, extra: Record<string, unknown> = {}): Element => ({ tagName, ...extra }) as unknown as Element;

describe('the on-screen keyboard', () => {
  it('is open only while a text field has focus and the visible height dropped by a keyboard', () => {
    // 390x844 with a 336px keyboard; an address bar folding away takes far less than a keyboard.
    expect(keyboardOpen(508, 844, true)).toBe(true);
    expect(keyboardOpen(508, 844, false)).toBe(false);
    expect(keyboardOpen(664, 745, true)).toBe(false);
    expect(keyboardOpen(844, 844, true)).toBe(false);
  });

  it('comes up for text fields, never for buttons, checkboxes or sliders', () => {
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    for (const type of ['button', 'checkbox', 'range', 'submit']) expect(isTypingTarget(el('INPUT', { type }))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
