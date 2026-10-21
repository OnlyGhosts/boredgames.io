# SEO: the invisible layer

Date: 2026-10-21. Status: for the owner's review.

## Goal

Make boredgames.io indexable and well described by search engines and link previews without adding anything a player can see. Today every URL serves the same empty app shell (one title, one description, one canonical, no robots.txt, no sitemap, unknown paths answer 200), so Google has nothing to read and shared links all show the same card.

## Non-goals (the owner's decisions)

- No new pages and no new visible copy, footer, tagline or toggle. The home screen stays "one column and two paths".
- No per-game landing pages: `/scribble` and the other slugs keep redirecting to `/`.
- No analytics on the site for now: Search Console and Bing Webmaster Tools only.
- No hidden text for crawlers. Google's spam policies treat text hidden from players as spam; the only screen-reader-only text stays what it is today (the `sr-only` H1 "boredgames.io" and labels), which is accessibility, not ranking copy.
- No structured data for things that are not on the page: no per-game VideoGame entries, no FAQ or HowTo (Google no longer shows those).

Expectation set with the owner: this gets the site indexed correctly, with the right title, description and preview card, and measurable in Search Console. It will not win the long-tail searches in the research report; those need pages with text.

## Design

### 1. One source of truth for page metadata

`client/src/platform/seo.ts` exports the public routes and their head values:

- `SITE_URL = 'https://boredgames.io'`.
- `PUBLIC_ROUTES`: for now only `/` (adding a route later adds it to the prerender, the sitemap and the tests at once).
- `headFor(route)`: `{ title, description, canonical, robots, ogImage }` for the app's route kinds:
  - home: title `boredgames.io: party games for phones in the same room` (54 characters); description `Free party games for friends in the same room: drawing, who is the spy, comedy answers, blackjack and poker. One room code, everyone on their own phone, no app and no accounts.` (under 160 characters); canonical `https://boredgames.io/`; robots `index, follow`.
  - a room (`/:slug/CODE`, legacy `/CODE`, `/?room=CODE`): title as today (`boredgames.io 🚪 CODE`); canonical `https://boredgames.io/`; robots `noindex, nofollow`.
  - unknown: title `Page not found | boredgames.io`; robots `noindex`.
  - `ogImage`: `/icons/icon-512.png` until the owner's share image lands, then `/og.png` (1200x630, `twitter:card summary_large_image`); the swap is a one-line change here plus the file.
- `jsonLd()`: the home page's structured data: `Organization` (name, url, logo), `WebSite` (name, url) and `WebApplication` (name, url, applicationCategory `GameApplication`, operatingSystem `Any`, browserRequirements `Requires JavaScript`, isAccessibleForFree true, offers price 0 GBP). Nothing per game.

### 2. Head tags set from the app, not by React hoisting

`client/src/platform/lib/head.ts` exports `applyHead(head)`, which writes `document.title` and the `content`/`href` of the existing `<meta name="description">`, `<link rel="canonical">`, `<meta name="robots">`, `og:title`, `og:description`, `og:url`, `og:image` and `twitter:*` elements. `App.tsx` calls it from the effect that sets the title today, for every route change. `client/index.html` keeps static elements with the home values (so a non-JS fetch of the shell still reads them) and gains `<meta name="robots" content="index, follow">`. No React `<title>`/`<meta>` elements, so hydration has nothing to match in the head.

### 3. The home page prerendered to real HTML

- `client/src/entry-prerender.tsx`: a Vite SSR entry exporting `renderRoute(path)` that returns the markup of `<App />` for that path via `react-dom/server` `renderToString`, with the games registered as `main.tsx` does. The screens are already rendered this way by the unit tests, so they are SSR-safe; the prerender runs with no `window`.
- `package.json` `build:client` becomes `vite build && vite build --ssr client/src/entry-prerender.tsx --outDir dist/prerender && tsx scripts/prerender.ts`.
- `scripts/prerender.ts`:
  1. Reads `dist/client/index.html`.
  2. For each public route: renders the markup, sets the head values from `seo.ts`, injects `<script type="application/ld+json">` for the home page, and replaces `<div id="root"></div>` with `<div id="root" data-prerendered="/">…markup…</div>`. Writes `dist/client/index.html` for `/` (a later route `/x` would go to `dist/client/x/index.html`, which Vercel serves at `/x` with `trailingSlash: false`).
  3. Writes `dist/client/404.html`: the shell with the home markup, the unknown-route head (noindex) and no `data-prerendered` flag, so the app mounts fresh and does what it does today for an unknown path (toast, then home).
  4. Writes `dist/client/sitemap.xml` listing `PUBLIC_ROUTES` with `lastmod` from the build id's commit date (`scripts/buildStamp.ts` already knows the commit).
  5. Fails the build if the home markup lacks `<h1` or the `[data-testid="home-create"]` button, or if the title or description differ from `seo.ts`.
- `client/src/main.tsx`: if `#root` has `data-prerendered` equal to `location.pathname`, `hydrateRoot` instead of `createRoot(...).render`; otherwise as today. Hydration mismatch rule: the home screen must render the same markup on the server and on the client's first render, so anything read from `localStorage` (a saved name, a saved theme) is applied in an effect after mount, never during the first render. The e2e below checks the console for hydration errors with a saved name present.

### 4. Hosting hygiene (`vercel.json`)

- `"trailingSlash": false` (`/scribble/` → 308 `/scribble`).
- Redirects (308): `/index.html` → `/`; `/(scribble|skribble|spygame|quipgame|blackjack|poker|template)` → `/` (what the client does today, now before any page loads).
- Rewrites narrowed to the app's routes: `/ws` and `/api/(.*)` as today; `/:slug(scribble|skribble|spygame|quipgame|blackjack|poker|template)/:code([A-Za-z0-9]{4})` and the legacy `/:code([A-Za-z0-9]{4})` → `/index.html`. Everything else falls through to the filesystem, then to `404.html` with a real 404 status.
- Headers: `/assets/(.*)` → `Cache-Control: public, max-age=31536000, immutable`; the two room-route sources → `X-Robots-Tag: noindex, nofollow`; `version.json` and the HTML routes keep their no-store / no-cache headers.
- `client/public/robots.txt`: `User-agent: *`, `Allow: /`, `Sitemap: https://boredgames.io/sitemap.xml`. No `Disallow` for rooms: a disallowed URL can never show its noindex.
- `client/public/<indexnow-key>.txt`: the IndexNow key (random 32 hex characters, generated once, committed; it is public by design).

### 5. The Fly copy of the site

`server/platform/app.ts` already serves `dist/client`. It gains: a `CANONICAL_HOST` (default `boredgames.io`); on any other host, `/robots.txt` answers `User-agent: *` / `Disallow: /` and every HTML response carries `X-Robots-Tag: noindex`. On every host, the SPA fallback is narrowed to the same room-route patterns as Vercel's, room HTML responses carry `X-Robots-Tag: noindex, nofollow`, and other unknown paths get `404.html` with status 404. The e2e suite runs against this server, so it is how the new behaviour is tested.

### 6. Faster indexing

`.github/workflows/indexnow.yml`: on push to `main`, after a short wait for Vercel, POST `{ host, key, keyLocation, urlList: PUBLIC_ROUTES }` to `https://api.indexnow.org/indexnow` (shared with Bing, Yandex, Naver, Seznam). Google is not a participant; its path is the sitemap and Search Console.

### 7. Search Console and Bing (owner steps, written into `docs/SEO.md`)

1. search.google.com/search-console → Add property → Domain → `boredgames.io` → copy the TXT record → add it where the domain's DNS lives → Verify. Domain properties can only be verified by DNS and cover www, apex, http and https.
2. Sitemaps → submit `https://boredgames.io/sitemap.xml`.
3. URL inspection on `https://boredgames.io/` → Test live URL (the rendered screenshot should show the front door) → Request indexing.
4. bing.com/webmasters → Import from Google Search Console.
5. After a week, check Pages → Not indexed for room links listed as "Excluded by noindex" (correct) and nothing listed as "Soft 404".

## Testing

- Unit (`client/src/platform/seo.test.ts`, `scripts/prerender.test.ts`): the home title is at most 60 characters and the description at most 160; canonical is absolute; room routes are noindex; JSON-LD parses and names the three types; the sitemap lists exactly `PUBLIC_ROUTES` with a valid `lastmod`; `vercel.json` has `trailingSlash: false`, the immutable assets header, the noindex headers and no catch-all rewrite to `index.html`.
- e2e (`e2e/seo.spec.ts`, against the built server): fetching `/` without JavaScript returns HTML with the title, description, canonical, `<h1>`, the Create and Join controls and the JSON-LD; `/robots.txt` and `/sitemap.xml` are served; `/scribble/ABCD` carries `X-Robots-Tag: noindex, nofollow`; `/nope/path` returns 404 with the shell; the home page hydrates with no console errors, including with a saved name in `localStorage`, and Create a room still works (the existing suites cover the rest).
- `npm run check` and the full e2e suite once before the push, as the house rules say.

## Rollout and verification

1. One commit on top of main, gate, push.
2. After Vercel deploys: `curl -sI` checks on the live site for the title and description in `/`, the 404 status on an unknown path, the 308 on `/scribble` and `/index.html`, the asset cache header, `/robots.txt`, `/sitemap.xml` and the noindex header on a room link.
3. The owner does the Search Console steps; the IndexNow workflow pings on the next push.

## Risks

- Hydration mismatch on the home page: covered by the effect rule and the console-error e2e; React 19 recovers by client-rendering if it ever happens, so players are never affected.
- Vercel serving `404.html` with a 404 status for a static output: verified on the live site after the deploy; if it does not, fall back to the catch-all rewrite plus a JS-set noindex on unknown paths (Google's documented SPA fix).
- `path-to-regexp` patterns in `vercel.json` cannot be run here; they are checked live after the deploy, and the express server mirrors them so the e2e covers the logic.
