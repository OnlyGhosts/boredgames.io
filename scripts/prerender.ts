/**
 * After `vite build`: writes the front door into dist/client/index.html as real HTML (the client
 * hydrates it), a 404.html for paths the app does not know (noindex, rendered afresh on load) and
 * sitemap.xml. The markup comes from the Vite SSR bundle of client/src/entry-prerender.tsx; the
 * head values and the structured data from client/src/platform/seo.ts. Run by `npm run build:client`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headWrites } from '../client/src/platform/lib/head';
import { PUBLIC_ROUTES, SITE_URL, homeHead, jsonLd, unknownHead, type Head } from '../client/src/platform/seo';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The shell's element a `tag[attr="value"]` selector names, with `attr` set to `value`; throws when the shell lacks it. */
function setAttribute(html: string, selector: string, attr: string, value: string): string {
  const match = selector.match(/^(\w+)\[([\w:-]+)="([^"]+)"\]$/);
  if (!match) throw new Error(`prerender: cannot read selector ${selector}`);
  const [, tag, byAttr, byValue] = match;
  const element = new RegExp(`<${tag}\\b[^>]*\\s${byAttr}="${escapeRegExp(byValue)}"[^>]*>`);
  if (!element.test(html)) throw new Error(`prerender: index.html has no ${selector}`);
  return html.replace(element, (el) => {
    const attrRe = new RegExp(`\\s${attr}="[^"]*"`);
    if (!attrRe.test(el)) throw new Error(`prerender: ${selector} has no ${attr} attribute`);
    return el.replace(attrRe, ` ${attr}="${escapeHtml(value)}"`);
  });
}

/** The shell with `head` written into its title and head elements, and `ld` (when given) as JSON-LD before </head>. */
export function withHead(shell: string, head: Head, ld: object[] | null): string {
  if (!/<title>[^<]*<\/title>/.test(shell)) throw new Error('prerender: index.html has no <title>');
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(head.title)}</title>`);
  for (const write of headWrites(head)) html = setAttribute(html, write.selector, write.attr, write.value);
  if (ld) {
    // '<' is escaped so the data can never close the script element.
    const json = JSON.stringify(ld).replace(/</g, '\\u003c');
    if (!html.includes('</head>')) throw new Error('prerender: index.html has no </head>');
    html = html.replace('</head>', `  <script type="application/ld+json">${json}</script>\n  </head>`);
  }
  return html;
}

/** The shell with `markup` inside #root; `prerenderedPath` marks it for hydration (main.tsx), null leaves the app to render afresh. */
export function withRoot(shell: string, markup: string, prerenderedPath: string | null): string {
  const root = '<div id="root"></div>';
  if (!shell.includes(root)) throw new Error('prerender: index.html has no empty <div id="root">');
  const open = prerenderedPath === null ? '<div id="root">' : `<div id="root" data-prerendered="${escapeHtml(prerenderedPath)}">`;
  return shell.replace(root, `${open}${markup}</div>`);
}

export function sitemapXml(routes: readonly string[], lastmod: string): string {
  const urls = routes.map((route) => `  <url><loc>${escapeHtml(SITE_URL + route)}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function headForRoute(route: string): Head {
  if (route === '/') return homeHead();
  throw new Error(`prerender: no head for public route ${route}; add it to client/src/platform/seo.ts`);
}

/** Writes index.html (the front door, hydrated), 404.html and sitemap.xml into `outDir` from the shell already there. */
export function prerender(outDir: string, render: (route: string) => string, lastmod: string): void {
  const shell = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  let home = '';
  for (const route of PUBLIC_ROUTES) {
    const markup = render(route);
    if (route === '/') {
      home = markup;
      const missing = ['<h1', 'data-testid="home-create"', 'data-testid="home-join"'].filter((needed) => !markup.includes(needed));
      if (missing.length) throw new Error(`prerender: the front door's markup lacks ${missing.join(' and ')}`);
    }
    const head = headForRoute(route);
    const html = withRoot(withHead(shell, head, route === '/' ? jsonLd() : null), markup, route);
    if (!html.includes(`<title>${escapeHtml(head.title)}</title>`) || !html.includes(`content="${escapeHtml(head.description)}"`)) {
      throw new Error(`prerender: ${route} does not carry the title and description of seo.ts`);
    }
    const file = route === '/' ? path.join(outDir, 'index.html') : path.join(outDir, route.replace(/^\//, ''), 'index.html');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  // Unknown paths: the front door's markup, rendered afresh on load (no data-prerendered), noindex.
  writeFileSync(path.join(outDir, '404.html'), withRoot(withHead(shell, unknownHead(), null), home, null));
  writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(PUBLIC_ROUTES, lastmod));
}

/** The commit's date (ISO, date only), or today's when there is no checkout (a Docker build). */
export function resolveLastmod(git: () => string | null = gitCommitDate, now: () => number = Date.now): string {
  const date = git() ?? new Date(now()).toISOString();
  return date.slice(0, 10);
}

function gitCommitDate(): string | null {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entry = new URL('../dist/prerender/entry-prerender.js', import.meta.url).href;
  const { renderRoute } = (await import(entry)) as { renderRoute: (route: string) => string };
  const outDir = path.resolve('dist/client');
  prerender(outDir, renderRoute, resolveLastmod());
  console.log(`prerendered ${PUBLIC_ROUTES.join(', ')} into ${outDir} with 404.html and sitemap.xml`);
}
