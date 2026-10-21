import { describe, expect, it } from 'vitest';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { applyHead, headWrites } = await import('./head');
const { headFor, homeHead } = await import('../seo');
const { parseRoute } = await import('../router');

describe('head', () => {
  it('writes the eight head values from a Head', () => {
    const writes = headWrites(homeHead());
    expect(writes.map((w) => w.selector)).toEqual([
      'meta[name="description"]',
      'link[rel="canonical"]',
      'meta[name="robots"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:url"]',
      'meta[property="og:image"]',
    ]);
    expect(writes[1]).toEqual({ selector: 'link[rel="canonical"]', attr: 'href', value: 'https://boredgames.io/' });
    expect(writes[2].value).toBe('index, follow');
    expect(writes[3].value).toBe(homeHead().title);
    expect(writes[6].value).toBe('https://boredgames.io/icons/icon-512.png');
  });

  it('applies them to a document, skipping anything missing', () => {
    const set = new Map<string, string>();
    const doc = {
      title: '',
      querySelector: (sel: string) => (sel.includes('og:image') ? null : { setAttribute: (a: string, v: string) => set.set(`${sel} ${a}`, v) }),
    } as unknown as Document;
    applyHead(headFor(parseRoute('/scribble/MRAN')), doc);
    expect(doc.title).toBe('boredgames.io 🚪 𝗠𝗥𝗔𝗡');
    expect(set.get('meta[name="robots"] content')).toBe('noindex, nofollow');
    expect(set.get('link[rel="canonical"] href')).toBe('https://boredgames.io/');
    expect(set.has('meta[property="og:image"] content')).toBe(false);
  });
});
