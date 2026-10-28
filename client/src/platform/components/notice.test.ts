import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoticeBanner } from './NoticeBanner';

describe('NoticeBanner', () => {
  it('shows the notice as literal text, never as markup', () => {
    const html = renderToStaticMarkup(createElement(NoticeBanner, { notice: { text: '<a href=x>hi</a> <script>alert(1)</script>' } }));
    expect(html).toContain('data-testid="site-notice"');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;a');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps the last two words together', () => {
    const html = renderToStaticMarkup(createElement(NoticeBanner, { notice: { text: 'Quick restart at 9pm' } }));
    expect(html).toContain('Quick restart at 9pm');
  });

  it('renders nothing without a notice', () => {
    expect(renderToStaticMarkup(createElement(NoticeBanner, { notice: {} }))).toBe('');
    expect(renderToStaticMarkup(createElement(NoticeBanner, { notice: null }))).toBe('');
    expect(renderToStaticMarkup(createElement(NoticeBanner, { notice: { text: '   ' } }))).toBe('');
  });
});
