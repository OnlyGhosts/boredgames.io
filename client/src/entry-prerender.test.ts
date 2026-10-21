import { describe, expect, it } from 'vitest';

// The render must need no browser: the build runs it in plain node, so no window at all here.
delete (globalThis as { window?: unknown }).window;

describe('entry-prerender', () => {
  it('renders the front door to HTML with no window', async () => {
    const { renderRoute } = await import('./entry-prerender');
    const html = renderRoute('/');
    expect(html).toContain('<h1 class="sr-only">Bored Games</h1>');
    expect(html).toContain('data-testid="home-create"');
    expect(html).toContain('data-testid="home-join"');
    expect(html).not.toContain('data-testid="toast"');
    expect(html).not.toContain('data-testid="name-step"');
  });

  it('renders the same markup twice: nothing random in the first paint', async () => {
    const { renderRoute } = await import('./entry-prerender');
    expect(renderRoute('/')).toBe(renderRoute('/'));
  });
});
