# SEO invisible layer: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make boredgames.io indexable and well described by search engines and link previews with nothing new on screen.

**Architecture:** One module (`client/src/platform/seo.ts`) holds every public route's head values and the site's structured data. The app writes them into the existing head elements on each route change. After the Vite build, a Vite SSR bundle renders the home screen to HTML and a script writes it into `dist/client/index.html` (hydrated by the client), a `404.html`, and `sitemap.xml`. Vercel and the Fly express server both serve room routes with a noindex header and unknown paths with a real 404.

**Tech Stack:** React 19 (`react-dom/server` `renderToString`, `hydrateRoot`), Vite 7 (`vite build --ssr`), `tsx` for the build script, vitest (node environment), Playwright e2e against the express server, Vercel (`vercel.json`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-seo-invisible-layer-design.md`

## Global Constraints

- Nothing new on screen: no pages, no copy, no controls. The home screen stays as it is.
- No text hidden from players for crawlers. Only the existing `sr-only` H1 and labels.
- Home title: `boredgames.io: party games for phones in the same room`. Home description: `Free party games for friends in the same room: drawing, who is the spy, comedy answers, blackjack and poker. One room code, everyone on their own phone, no app and no accounts.`
- Room routes (`/:slug/CODE`, legacy `/CODE`): `noindex, nofollow`. Unknown paths: real 404 status, head `noindex`.
- `og:image` stays `/icons/icon-512.png` and `twitter:card` `summary` until the owner's share image lands.
- Structured data on the home page only: `Organization`, `WebSite`, `WebApplication`. Nothing per game, no FAQ, no HowTo.
- No analytics. `robots.txt` never disallows room paths.
- House rules: fix root causes; tests change to the new truth; `npm run check` and the full e2e suite once before the push; British English, no em dashes, curly apostrophes in copy.
- Never run `playwright install`; never load a Vite dev server in a browser; prefix builds with `nice -n 10`.

## Review Focus

1. A returning player with a saved name opens `/`: the page must hydrate with no console error and the name must appear in the field. Pinned in Task 7.
2. A mixed-case room link (`/SPYGAME/mran`, `/Scribble/MRAN`) must still open the room through the express server's narrowed fallback. Pinned in Task 5.
3. `/?room=MRAN` and `/?game=scribble` must still open the front door with the code or game, since `/` is now a prerendered file. Pinned in Task 7.
4. An unknown path (`/nope/path`) must answer 404, and the app on it must still show the toast and go to the front door, without a hydration error (the 404 page carries no `data-prerendered`). Pinned in Task 7.
5. A share link's preview card (fetched without JavaScript) must carry the home card plus `noindex`, never a stale per-room title from a previous prerender. Pinned in Task 7.

---

### Task 1: Page metadata in one module

**Files:**
- Create: `client/src/platform/seo.ts`
- Test: `client/src/platform/seo.test.ts`

**Interfaces:**
- Produces: `SITE_URL = 'https://boredgames.io'`; `PUBLIC_ROUTES: readonly string[]` (`['/']`); `interface Head { title: string; description: string; canonical: string; robots: 'index, follow' | 'noindex, nofollow' | 'noindex'; ogImage: string }`; `headFor(route: Route): Head` (`Route` from `./router`); `homeHead(): Head`; `unknownHead(): Head`; `jsonLd(): object[]` (the three entries, in order Organization, WebSite, WebApplication).

- [ ] **Step 1: Write the failing test**

```ts
// client/src/platform/seo.test.ts (vitest, node environment, dynamic imports like the other client tests)
it('describes the home page within the limits search engines show', () => {
  const head = homeHead();
  expect(head.title).toBe('boredgames.io: party games for phones in the same room');
  expect(head.title.length).toBeLessThanOrEqual(60);
  expect(head.description.length).toBeLessThanOrEqual(160);
  expect(head.canonical).toBe('https://boredgames.io/');
  expect(head.robots).toBe('index, follow');
  expect(head.ogImage).toBe('https://boredgames.io/icons/icon-512.png');
});
it('keeps rooms and unknown paths out of the index, pointing at the front door', () => {
  expect(headFor(parseRoute('/scribble/MRAN'))).toMatchObject({ robots: 'noindex, nofollow', canonical: 'https://boredgames.io/', title: 'boredgames.io 🚪 MRAN' });
  expect(headFor(parseRoute('/MRAN'))).toMatchObject({ robots: 'noindex, nofollow' });
  expect(headFor(parseRoute('/nope/path'))).toMatchObject({ robots: 'noindex', title: 'Page not found | boredgames.io' });
  expect(headFor(parseRoute('/'))).toEqual(homeHead());
});
it('lists the public routes and names the site in structured data', () => {
  expect(PUBLIC_ROUTES).toEqual(['/']);
  const types = jsonLd().map((o) => (o as { '@type': string })['@type']);
  expect(types).toEqual(['Organization', 'WebSite', 'WebApplication']);
  const app = jsonLd()[2] as Record<string, unknown>;
  expect(app).toMatchObject({ applicationCategory: 'GameApplication', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' } });
  expect(JSON.parse(JSON.stringify(jsonLd()))).toHaveLength(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nice -n 10 npx vitest run client/src/platform/seo.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `client/src/platform/seo.ts`**

`headFor` switches on `route.kind`: `'home'` with a code → the room head (title from `roomTitle(code)` in `App.tsx`, moved here as `roomTitle(code: string): string`; `App.tsx` imports it from `./platform/seo`), `'home'` without a code → `homeHead()`, `'game'` → `homeHead()` (it redirects), `'unknown'` → `unknownHead()`. Every `ogImage` and `canonical` is absolute (`SITE_URL` + path). `jsonLd()` returns plain objects with `@context: 'https://schema.org'`; Organization `logo` is the absolute icon URL; WebApplication `browserRequirements: 'Requires JavaScript'`, `url: SITE_URL + '/'`, `name: 'boredgames.io'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `nice -n 10 npx vitest run client/src/platform/seo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/platform/seo.ts client/src/platform/seo.test.ts client/src/App.tsx
git commit -m "SEO: one module names every public page's title, description and structured data"
```

---

### Task 2: The app writes the head on every route

**Files:**
- Create: `client/src/platform/lib/head.ts`
- Modify: `client/index.html` (the `<head>`), `client/src/App.tsx:42-50` (`useUrlSync`, which sets `document.title` today)
- Test: `client/src/platform/lib/head.test.ts`

**Interfaces:**
- Consumes: `Head`, `headFor`, `homeHead` from Task 1.
- Produces: `headWrites(head: Head): Array<{ selector: string; attr: 'content' | 'href'; value: string }>` (pure; the eight writes: `meta[name="description"]`, `link[rel="canonical"]`, `meta[name="robots"]`, `meta[property="og:title"]`, `meta[property="og:description"]`, `meta[property="og:url"]`, `meta[property="og:image"]`, `meta[name="twitter:card"]` stays `summary`), and `applyHead(head: Head, doc: Document = document): void` (sets `doc.title`, then each write via `querySelector`; a missing element is skipped).

- [ ] **Step 1: Write the failing test**

```ts
it('writes the eight head values from a Head', () => {
  const writes = headWrites(homeHead());
  expect(writes.map((w) => w.selector)).toEqual(['meta[name="description"]', 'link[rel="canonical"]', 'meta[name="robots"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:image"]']);
  expect(writes[1]).toEqual({ selector: 'link[rel="canonical"]', attr: 'href', value: 'https://boredgames.io/' });
  expect(writes[2].value).toBe('index, follow');
});
it('applies them to a document, skipping anything missing', () => {
  const set = new Map<string, string>();
  const doc = { title: '', querySelector: (sel: string) => (sel.includes('og:image') ? null : { setAttribute: (a: string, v: string) => set.set(`${sel} ${a}`, v) }) } as unknown as Document;
  applyHead(headFor(parseRoute('/scribble/MRAN')), doc);
  expect(doc.title).toBe('boredgames.io 🚪 MRAN');
  expect(set.get('meta[name="robots"] content')).toBe('noindex, nofollow');
  expect(set.has('meta[property="og:image"] content')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nice -n 10 npx vitest run client/src/platform/lib/head.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `head.ts`; add `<meta name="robots" content="index, follow" />` to `client/index.html` after the description; replace `document.title = roomTitle(code)` in `useUrlSync` with a new `useHead()` hook in `App.tsx` that runs `applyHead(headFor(route))` in an effect on `[route, code]` (a room present → the room head via `headFor(parseRoute(roomPath(gameId, code)))`, otherwise the route's head)**

`index.html` keeps its static home values; they are what a crawler reads from the shell before any script.

- [ ] **Step 4: Run tests**

Run: `nice -n 10 npx vitest run client/src/platform/lib/head.test.ts client/src/platform/seo.test.ts && nice -n 10 npx tsc -p client --noEmit`
Expected: PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add client/src/platform/lib/head.ts client/src/platform/lib/head.test.ts client/index.html client/src/App.tsx
git commit -m "SEO: the app sets title, description, canonical and robots on every route"
```

---

### Task 3: The home screen renders without a browser

**Files:**
- Modify: `client/src/platform/router.ts:88-99` (`currentRoute`), `client/src/platform/screens/Home.tsx:91-92` (name and avatar state), `client/src/platform/lib/media.ts:30-38` (`useMediaQuery`)
- Create: `client/src/entry-prerender.tsx`
- Test: `client/src/entry-prerender.test.ts`

**Interfaces:**
- Produces: `renderRoute(path: string): string` (the markup of `<App />` for `path`, games registered, store at its defaults, no `window`).

- [ ] **Step 1: Write the failing test**

```ts
// client/src/entry-prerender.test.ts: delete (globalThis as { window?: unknown }).window before importing, so the render proves it needs no browser.
it('renders the front door to HTML with no window', async () => {
  const { renderRoute } = await import('./entry-prerender');
  const html = renderRoute('/');
  expect(html).toContain('<h1 class="sr-only">boredgames.io</h1>');
  expect(html).toContain('data-testid="home-create"');
  expect(html).toContain('data-testid="home-join"');
  expect(html).not.toContain('data-testid="toast"');
});
it('renders the same markup twice: nothing random in the first paint', async () => {
  const { renderRoute } = await import('./entry-prerender');
  expect(renderRoute('/')).toBe(renderRoute('/'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nice -n 10 npx vitest run client/src/entry-prerender.test.ts`
Expected: FAIL (module not found, or `window is not defined` from `router.ts`)

- [ ] **Step 3: Make the first render browser-free and deterministic**

- `router.ts`: `currentRoute()` returns `parseRoute('/')` when `typeof window === 'undefined'`.
- `Home.tsx`: `useState('')` for the name and `useState<AvatarData | null>(null)` for the avatar; a `useEffect` on mount sets them from `loadName()` and `loadAvatar() ?? randomAvatar()`; everything that reads `avatar` handles `null` as "not chosen yet" (the who-panel renders only after a tap, so the first paint never shows it).
- `media.ts`: `useMediaQuery` becomes `useSyncExternalStore(subscribe, () => matchesMedia(query), () => false)`, so hydration's first render matches the server and a plain client render still reads the real value at once.
- `entry-prerender.tsx`: `registerGames(GAMES)` as `main.tsx` does, `useRouter.setState({ route: parseRoute(path) })`, then `renderToString(<StrictMode><App /></StrictMode>)`.

- [ ] **Step 4: Run the tests and the suites that touch the home screen**

Run: `nice -n 10 npx vitest run client/src/entry-prerender.test.ts client/src/platform && nice -n 10 npx tsc -p client --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/platform/router.ts client/src/platform/screens/Home.tsx client/src/platform/lib/media.ts client/src/entry-prerender.tsx client/src/entry-prerender.test.ts
git commit -m "SEO: the front door renders to HTML with no browser, the same every time"
```

---

### Task 4: Prerender, 404 page and sitemap at build time; hydrate on load

**Files:**
- Create: `scripts/prerender.ts`, `scripts/prerender.test.ts`
- Modify: `package.json` (`build:client`), `client/src/main.tsx`, `vite.config.ts` (an SSR build must not run the `buildStamp` plugin twice or emit `version.json` from the SSR pass; guard on `ssrBuild`/`isSsrBuild`)

**Interfaces:**
- Consumes: `renderRoute` (Task 3), `headWrites`/`Head` (Task 2), `PUBLIC_ROUTES`, `homeHead`, `unknownHead`, `jsonLd` (Task 1), `resolveBuildId` (`scripts/buildStamp.ts`).
- Produces (pure, exported for tests): `withHead(shell: string, head: Head, ld: object[] | null): string` (rewrites `<title>` and the eight head values in the shell's `<head>`; appends `<script type="application/ld+json">` before `</head>` when `ld` is given); `withRoot(shell: string, markup: string, prerenderedPath: string | null): string` (replaces `<div id="root"></div>`; sets `data-prerendered` when a path is given); `sitemapXml(routes: readonly string[], lastmod: string): string`; `prerender(outDir: string, render: (path: string) => string, lastmod: string): void` (writes `index.html`, `404.html`, `sitemap.xml`; throws if the home markup lacks `<h1` or `data-testid="home-create"`).

- [ ] **Step 1: Write the failing tests**

```ts
const shell = readFileSync('client/index.html', 'utf8');
it('puts the home head, structured data and markup into the shell', () => {
  const html = withRoot(withHead(shell, homeHead(), jsonLd()), '<main>front door</main>', '/');
  expect(html).toContain('<title>boredgames.io: party games for phones in the same room</title>');
  expect(html).toContain('<meta name="robots" content="index, follow"');
  expect(html).toContain('<script type="application/ld+json">');
  expect(html).toContain('<div id="root" data-prerendered="/"><main>front door</main></div>');
  expect(html.match(/<title>/g)).toHaveLength(1);
});
it('makes a 404 page that is noindex and not marked as prerendered', () => {
  const html = withRoot(withHead(shell, unknownHead(), null), '<main>x</main>', null);
  expect(html).toContain('<meta name="robots" content="noindex"');
  expect(html).toContain('<div id="root"><main>x</main></div>');
  expect(html).not.toContain('application/ld+json');
});
it('lists the public routes in the sitemap with the build date', () => {
  expect(sitemapXml(['/'], '2026-10-21')).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://boredgames.io/</loc><lastmod>2026-10-21</lastmod></url>\n</urlset>\n');
});
it('refuses a home page that lost its front door', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pre-'));
  writeFileSync(join(dir, 'index.html'), shell);
  expect(() => prerender(dir, () => '<div>nothing</div>', '2026-10-21')).toThrow(/home-create/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nice -n 10 npx vitest run scripts/prerender.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `scripts/prerender.ts`; when run as a script (`import.meta.url` is the main module) it imports `../dist/prerender/entry-prerender.js`, resolves `lastmod` as the ISO date of `git log -1 --format=%cI` (falling back to today's date), and calls `prerender('dist/client', renderRoute, lastmod)`**

`package.json`: `"build:client": "vite build && vite build --ssr client/src/entry-prerender.tsx --outDir dist/prerender && tsx scripts/prerender.ts"`. `vite.config.ts`: skip `buildStamp`'s `version.json` emit on the SSR pass but keep the same build id define.

- [ ] **Step 4: Hydrate in `client/src/main.tsx`**

If `container.dataset.prerendered === location.pathname`, `hydrateRoot(container, tree)`; otherwise `createRoot(container).render(tree)` as today. Keep `registerGames(GAMES)` before either.

- [ ] **Step 5: Build and check the output**

Run: `nice -n 10 npm run build:client && grep -c 'data-prerendered="/"' dist/client/index.html && grep -c 'noindex' dist/client/404.html && cat dist/client/sitemap.xml && nice -n 10 npx vitest run scripts`
Expected: `1`, `1`, the sitemap with one URL and today's date, tests PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/prerender.ts scripts/prerender.test.ts package.json client/src/main.tsx vite.config.ts
git commit -m "SEO: the build writes the front door as real HTML, a 404 page and a sitemap"
```

---

### Task 5: The express server mirrors the hosting rules

**Files:**
- Modify: `server/platform/app.ts:74-100` (static serving and the SPA fallback), `AppOptions` (add `canonicalHost?: string`, default `process.env.CANONICAL_HOST ?? 'boredgames.io'`)
- Test: `server/platform/app.test.ts` (new `describe('crawlers')`, in the file's style: `createApp({ driver, serveStatic: true, clientDir })` on port 0 and `fetch`)

**Interfaces:**
- Produces: `isRoomPath(pathname: string): boolean` exported from `shared/platform/roomCode.ts` (true for `/:slug/CODE` with a known current or former slug in any case, and for a bare `/CODE`, where CODE is 4 letters or digits in any case); the server and `vercel.json` (Task 6) agree on these shapes.

- [ ] **Step 1: Write the failing tests**

```ts
// a temp clientDir with index.html, 404.html, robots.txt and version.json written by the test
it('serves room links with a noindex header and the shell', async () => {
  for (const path of ['/scribble/MRAN', '/SPYGAME/mran', '/Scribble/MRAN', '/MRAN']) {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await res.text()).toContain('id="root"');
  }
});
it('answers an unknown path with the 404 page and a 404 status', async () => {
  const res = await fetch(`${base}/nope/path`);
  expect(res.status).toBe(404);
  expect(await res.text()).toContain('noindex');
});
it('hides a copy of the site on any host but the canonical one', async () => {
  const other = await fetch(`${base}/robots.txt`, { headers: { host: 'boredgames-io.fly.dev' } });
  expect(await other.text()).toBe('User-agent: *\nDisallow: /\n');
  expect((await fetch(`${base}/`, { headers: { host: 'boredgames-io.fly.dev' } })).headers.get('x-robots-tag')).toBe('noindex');
  const canonical = await fetch(`${base}/robots.txt`, { headers: { host: 'boredgames.io' } });
  expect(await canonical.text()).toContain('Allow: /');
  expect((await fetch(`${base}/`, { headers: { host: 'boredgames.io' } })).headers.get('x-robots-tag')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nice -n 10 npx vitest run server/platform/app.test.ts -t crawlers`
Expected: FAIL (`isRoomPath` missing; 200 on the unknown path)

- [ ] **Step 3: Implement**

In `app.ts`, before `express.static`: a middleware that, when `req.hostname !== canonicalHost`, answers `/robots.txt` with the disallow text (`text/plain`) and sets `X-Robots-Tag: noindex` on every other response. The fallback: `isRoomPath(req.path)` → `X-Robots-Tag: noindex, nofollow` and `sendFile('index.html')`; otherwise `res.status(404).sendFile('404.html', ...)` (the existing dotfiles/root options). `isRoomPath` lives in `shared/platform/roomCode.ts` next to `ROOM_CODE_LENGTH`, using `gameBySlug`/`gameByFormerSlug` from `shared/platform/games.ts`.

- [ ] **Step 4: Run the server tests and typecheck**

Run: `nice -n 10 npx vitest run server shared && nice -n 10 npx tsc -p server/tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/platform/app.ts server/platform/app.test.ts shared/platform/roomCode.ts
git commit -m "SEO: the server marks room links noindex, answers 404 for unknown paths, hides its Fly copy"
```

---

### Task 6: Vercel config, robots.txt, IndexNow

**Files:**
- Modify: `vercel.json`
- Create: `client/public/robots.txt`, `client/public/<key>.txt` (the key: `openssl rand -hex 16`, committed), `.github/workflows/indexnow.yml`, `scripts/indexnow.mjs`
- Test: `scripts/vercel.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_ROUTES` (Task 1; the workflow script reads the sitemap it fetches from the live site instead of importing TypeScript).

- [ ] **Step 1: Write the failing test**

```ts
const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
it('serves one URL per page and caches hashed assets for a year', () => {
  expect(cfg.trailingSlash).toBe(false);
  expect(cfg.headers).toContainEqual({ source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] });
});
it('marks room links noindex and rewrites only room links to the app', () => {
  const room = '/:slug(scribble|skribble|spygame|quipgame|blackjack|poker|template)/:code([A-Za-z0-9]{4})';
  const bare = '/:code([A-Za-z0-9]{4})';
  for (const source of [room, bare]) {
    expect(cfg.rewrites).toContainEqual({ source, destination: '/index.html' });
    expect(cfg.headers).toContainEqual({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] });
  }
  expect(cfg.rewrites.map((r: { source: string }) => r.source)).not.toContain('/((?!api/|ws$|assets/|icons/|manifest.webmanifest|favicon.svg).*)');
});
it('redirects the old game paths and index.html to the front door', () => {
  expect(cfg.redirects).toContainEqual({ source: '/index.html', destination: '/', permanent: true });
  expect(cfg.redirects).toContainEqual({ source: '/(scribble|skribble|spygame|quipgame|blackjack|poker|template)', destination: '/', permanent: true });
});
it('ships robots.txt and the IndexNow key', () => {
  expect(readFileSync('client/public/robots.txt', 'utf8')).toBe('User-agent: *\nAllow: /\nSitemap: https://boredgames.io/sitemap.xml\n');
  const keys = readdirSync('client/public').filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  expect(keys).toHaveLength(1);
  expect(readFileSync(`client/public/${keys[0]}`, 'utf8').trim()).toBe(keys[0].replace('.txt', ''));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nice -n 10 npx vitest run scripts/vercel.test.ts`
Expected: FAIL

- [ ] **Step 3: Edit `vercel.json`, add the two public files, the workflow and the script**

`vercel.json` keeps `/ws` and `/api/(.*)` rewrites, `version.json` no-store, and the no-cache header on HTML routes (`/index.html`, `/`, the two room sources). `scripts/indexnow.mjs`: fetch `https://boredgames.io/sitemap.xml`, collect `<loc>` values, POST JSON `{ host: 'boredgames.io', key, keyLocation: 'https://boredgames.io/<key>.txt', urlList }` to `https://api.indexnow.org/indexnow`, exit 0 on 200 or 202, print the status otherwise. `.github/workflows/indexnow.yml`: on push to `main`, `sleep 120` then `node scripts/indexnow.mjs` (no secrets needed).

- [ ] **Step 4: Run the test**

Run: `nice -n 10 npx vitest run scripts/vercel.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add vercel.json client/public/robots.txt client/public/*.txt .github/workflows/indexnow.yml scripts/indexnow.mjs scripts/vercel.test.ts
git commit -m "SEO: Vercel serves one URL per page, caches assets, 404s unknown paths; robots and IndexNow"
```

---

### Task 7: End-to-end proof against the built server

**Files:**
- Create: `e2e/seo.spec.ts`
- Modify: `e2e/game.spec.ts` or `e2e/home.spec.ts` only if an existing assertion about `/scribble` client-side redirects or unknown paths now needs the new truth (a 308 on Vercel is not visible to the express server; the client redirect stays)

- [ ] **Step 1: Write the failing spec**

```ts
test('the front door is real HTML before any script runs', async ({ request, baseURL }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('<title>boredgames.io: party games for phones in the same room</title>');
  expect(html).toContain('<link rel="canonical" href="https://boredgames.io/"');
  expect(html).toContain('<meta name="robots" content="index, follow"');
  expect(html).toContain('data-testid="home-create"');
  expect(html).toContain('<h1 class="sr-only">boredgames.io</h1>');
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)![1]);
  expect(ld.map((o: { '@type': string }) => o['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication']);
  expect((await request.get('/robots.txt')).ok()).toBe(true);
  expect(await (await request.get('/sitemap.xml')).text()).toContain('<loc>https://boredgames.io/</loc>');
});
test('a share link shows the front door card and stays out of the index', async ({ request }) => {
  const res = await request.get('/scribble/ZZZZ');
  expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(await res.text()).toContain('<title>boredgames.io: party games for phones in the same room</title>');
});
test('an unknown path is a real 404 and still lands on the front door', async ({ page, request }) => {
  expect((await request.get('/nope/path')).status()).toBe(404);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/nope/path');
  await expect(page.getByTestId('toast')).toContainText('front door');
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});
for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`${size.width}x${size.height}: a returning player hydrates the front door with no errors`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('boredgames.name', 'Hosty'));
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/?room=MRAN');
    await expect(page.getByTestId('home-join')).toBeVisible();
    // the code from the query is filled in, the saved name follows after mount
    await expect(page.locator('[data-testid="join-code"] input, [data-testid="join-code"]').first()).toBeVisible();
    await page.getByTestId('home-create').click();
    await expect(page.getByTestId('home-name')).toHaveValue('Hosty');
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
```

(Use the real test ids for the code boxes and name field from `Home.tsx`; the plan's selectors above name `home-name` for the name input and `join-code` for the code boxes; read `Home.tsx` for the exact ids and adjust the two locators, nothing else.)

- [ ] **Step 2: Build and run the spec, expecting the hydration and 404 tests to fail before Tasks 4 and 5 are in place; after them, all pass**

Run (through the session lock): `nice -n 10 npm run build && sh $SP/cifix-e2e/sync.sh && E2E_RESTART_PORT=6265 $SP/e2e-run.sh $SP/cifix-e2e/run $SP/seo/e2e.log e2e/seo.spec.ts e2e/home.spec.ts e2e/game.spec.ts`
Expected: `EXIT 0`

- [ ] **Step 3: Commit**

```bash
git add e2e/seo.spec.ts
git commit -m "SEO e2e: real HTML on the front door, noindex rooms, true 404, clean hydration"
```

---

### Task 8: Docs, the full gate and the live check

**Files:**
- Create: `docs/SEO.md` (the owner's Search Console and Bing steps from the spec, section 7, plus the live `curl` checks)
- Modify: `README.md` (one bullet under deploy behaviour: the build prerenders the front door, writes `404.html` and `sitemap.xml`; room links are noindex), `docs/ADDING_A_GAME.md` (the platform section that describes routing: a new public page joins `PUBLIC_ROUTES` and gets its head in `seo.ts`)

- [ ] **Step 1: Write the docs**

- [ ] **Step 2: Squash the task commits into one commit on top of main with a player-facing message, then run the gate**

Run: `bash $SP/polish-bars/gate/gate.sh > $SP/seo/gate.out 2>&1` (npm run check, then the full e2e)
Expected: `check exit 0`, `EXIT 0`

- [ ] **Step 3: Push to main; after Vercel deploys, check the live site**

```bash
curl -s https://boredgames.io/ | grep -o '<title>[^<]*</title>'
curl -sI https://boredgames.io/nope/path | head -1          # HTTP/2 404
curl -sI https://boredgames.io/scribble | grep -i location   # 308 to /
curl -sI https://boredgames.io/scribble/ZZZZ | grep -i x-robots-tag
curl -sI "https://boredgames.io$(curl -s https://boredgames.io/ | grep -o '/assets/[^"]*\.js' | head -1)" | grep -i cache-control
curl -s https://boredgames.io/robots.txt; curl -s https://boredgames.io/sitemap.xml
```
Expected: the home title; 404; `location: /`; `noindex, nofollow`; `immutable`; the two files.

- [ ] **Step 4: Tell the owner the Search Console steps are in `docs/SEO.md` and waiting on their DNS record**
