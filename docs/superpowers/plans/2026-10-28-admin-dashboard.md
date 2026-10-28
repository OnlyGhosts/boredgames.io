# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admin.boredgames.io`, behind a password, with three pages (analytics, live rooms, site notice), backed by cookieless visit counting and room-event counting on the Fly game server.

**Architecture:**
- **Pure logic:** day keys, visitor keys, sources, bot filtering and room events, in `server/platform/admin/analytics.ts`.
- **Storage:** an `AnalyticsStore` interface with a memory backend and a SQLite backend (`node:sqlite`, on a Fly volume).
- **Routing:** the existing Express app gains a public beacon and notice routes, plus a host-gated admin router: session cookie, login, and JSON endpoints.
- **The admin UI:** a separate small Vite build, `dist/admin`, served only on the admin host. It's never deployed to Vercel.
- **The client:** sends one beacon per page load and one when someone joins from the same-Wi-Fi list, and shows the notice banner on Home.

**Tech Stack:** Node 22 (`node:sqlite`), Express 5, ws, React 19, Vite, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-admin-dashboard-design.md`

## Global Constraints

- Admin routes answer only when `req.hostname === ADMIN_HOST`. Default `admin.boredgames.io`; e2e uses `admin.localhost`.
- The site host never serves admin routes; `/admin*` there is a 404.
- `ADMIN_PASSWORD` unset or empty means the admin host shows a "not set up" page and every admin API returns 503.
- **Session cookie:**
  - name `bg_admin`, set `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000` (30 days), with **no** `Domain` attribute;
  - value `base64url(JSON{exp})` + "." + HMAC-SHA256;
  - signing key = HMAC-SHA256(key: `ADMIN_SESSION_KEY`, data: `ADMIN_PASSWORD`).
- Password checks use `crypto.timingSafeEqual` on SHA-256 digests.
- **Login rate limit:** per network key (`clientAddress` + `networkKey`, as nearby uses), 5 free failures, then a delay of 2^(n-5) seconds capped at 300.
- **Visitor key:** `sha256(salt + "\0" + ip + "\0" + userAgent)`, base64url, first 22 chars. The salt is 32 random bytes in memory only, regenerated when the UK day changes. IP and user agent are never stored.
- Day keys are `YYYY-MM-DD` in `Europe/London`, and hours are `0..23` in Europe/London.
- **Kept:** raw visit and event rows for 90 days, daily aggregates forever.
- **Beacon:** body at most 2048 bytes, `text/plain` JSON (no CORS preflight), at most 30 per minute per network key, always answers 204, and never errors to the client.
- **Notice:** text is 1 to 140 characters of plain text, rendered with React text nodes only. The public `GET /api/notice` is cached for 30 s server-side. An expired notice is never served.
- **Bots:** a user agent matching `/bot|crawl|spider|slurp|headless|prerender|lighthouse/i` isn't counted. In e2e, Playwright's headless UA is allowed through by the env `ANALYTICS_COUNT_HEADLESS=1`.
- **Copy:** no em dashes, curly apostrophes, never a single word alone on a line. The site's design tokens, one column on phones.
- No new runtime dependency except what Node 22 ships. Commit trailers as in the repo's recent commits.

## Review Focus

1. **Reddit often sends only its origin as referrer** (`https://www.reddit.com/`) under strict-origin policy. That must count as source `reddit.com` with subreddit `null` and show as "Reddit (subreddit not given)", never dropped. A `?ref=<word>` on the landing URL, if present, wins as the source label. *Test in Task 1.*
2. **Day boundaries around the UK clock change** (25 Oct and 29 Mar): `00:30 BST` belongs to that UK date, not the UTC date. *Test in Task 1.*
3. **`ADMIN_PASSWORD` missing:** the admin host serves the not-set-up page, and the APIs return 503, never 500. *Test in Task 4.*
4. **Beacon abuse:** a body over 2048 bytes, malformed JSON or a flood answer 204 and record nothing past the cap. *Test in Task 3.*
5. **Notice with markup** (`<script>`, `<a href>`): shown as literal text. 141 characters are rejected with 400, and an expired notice is absent from `GET /api/notice`. *Tests in Tasks 3 and 6.*

---

### Task 1: Pure analytics logic

**Files:**
- Create: `server/platform/admin/analytics.ts`
- Test: `server/platform/admin/analytics.test.ts`

**Interfaces:**
- Produces:
  - `ukDay(ts: number): string`;
  - `ukHour(ts: number): number`;
  - `class DailySalt { constructor(now: () => number, random?: () => Buffer); current(): Buffer }`;
  - `visitorKey(salt: Buffer, ip: string, ua: string): string`;
  - `parseSource(referrer: string | null, landing: { ref: string | null }, siteHosts: string[]): { source: string; subreddit: string | null }`, where `source` is `'direct'`, a hostname without `www.`/`old.`, or `ref:<word>`;
  - `isBot(ua: string, countHeadless: boolean): boolean`;
  - `type RoomEvent = { kind: 'room_created'; gameId: GameId } | { kind: 'player_joined'; gameId: GameId } | { kind: 'game_started'; gameId: GameId; players: number } | { kind: 'game_ended'; gameId: GameId; finished: boolean }`;
  - `roomEvents(before: PlatformRoomData | null, after: PlatformRoomData): RoomEvent[]`.

- [ ] **Step 1: Write failing tests.**
  - `ukDay(Date.UTC(2026,9,24,23,30))` is `'2026-10-25'` (BST, so 00:30 UK). `ukDay(Date.UTC(2026,9,25,23,30))` is `'2026-10-25'` (GMT).
  - `ukHour` agrees with those.
  - `DailySalt` returns the same salt within one UK day and a different salt after the UK date changes.
  - `visitorKey` is 22 chars, stable for the same inputs, and differs when the salt changes. Its output doesn't contain the IP.
  - `parseSource`:
    - `https://www.reddit.com/r/WebGames/comments/x/y/` → `{source:'reddit.com', subreddit:'r/WebGames'}`
    - `https://www.reddit.com/` → `{source:'reddit.com', subreddit:null}`
    - `https://old.reddit.com/r/playmygame/` → `r/playmygame`
    - `https://boredgames.io/` (own host) → `direct`
    - `null` → `direct`
    - `{ref:'sideproject'}` wins → `ref:sideproject`
  - `isBot`: `Googlebot` → true; a Chrome UA → false; `HeadlessChrome` → true unless `countHeadless`.
  - `roomEvents`:
    - `null` → room with 1 player and phase lobby gives `[room_created, player_joined]`;
    - a new player id gives `player_joined`;
    - lobby → playing gives `game_started` with the player count;
    - playing → lobby with `results !== null` gives `game_ended{finished:true}`, and with `results === null` gives `finished:false`;
    - a rejoin (same ids, connection change only) gives `[]`.
- [ ] **Step 2:** `npx vitest run server/platform/admin/analytics.test.ts`. Expect FAIL, module missing.
- [ ] **Step 3: Implement.** Use `Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London'})` for day and hour.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5: Commit** "Admin: pure analytics logic (UK days, visitor keys, sources, room events)".

### Task 2: Analytics store (memory and SQLite)

**Files:**
- Create: `server/platform/admin/store.ts` (interface and memory), `server/platform/admin/sqliteStore.ts`, `server/platform/admin/openStore.ts`
- Test: `server/platform/admin/store.test.ts`

**Interfaces:**
- Consumes `ukDay` and `ukHour` from Task 1.
- Produces:
  - `type Visit = { ts: number; visitor: string; path: string; source: string; subreddit: string | null; game: string | null; device: 'phone'|'tablet'|'desktop' }`;
  - `type EventRow = { ts: number; kind: RoomEvent['kind'] | 'nearby_join'; gameId: string | null; players?: number; finished?: boolean }`;
  - `type Notice = { text: string; on: boolean; expiresAt: number | null; updatedAt: number }`;
  - `type Range = 'today' | '7d' | '30d'`;
  - `type Summary = { days: { day: string; visitors: number; views: number; rooms: number; players: number; started: number; finished: number }[]; totals: {...same fields}; sources: { source: string; subreddit: string | null; visitors: number }[]; games: { gameId: string; started: number; finished: number; avgPlayers: number }[]; deepLinks: { game: string; visitors: number }[]; joinsNearby: number; joinsCode: number; peakPlayers: number; busiestHour: number | null }`;
  - `interface AnalyticsStore { recordVisit(v: Visit): void; recordEvent(e: EventRow): void; notePlayersOnline(n: number, ts: number): void; summary(range: Range, now: number): Promise<Summary>; getNotice(): Promise<Notice | null>; setNotice(n: Notice | null): Promise<void>; prune(now: number): Promise<void>; close(): Promise<void> }`;
  - `class MemoryAnalyticsStore implements AnalyticsStore`;
  - `class SqliteAnalyticsStore implements AnalyticsStore { constructor(path: string) }`;
  - `openStore(env: NodeJS.ProcessEnv): AnalyticsStore`, which gives SQLite when `ANALYTICS_DB` is set, otherwise memory.

- [ ] **Step 1: Confirm `node:sqlite` loads** on the Docker image's Node: `docker` is not available, so run `node -e "require('node:sqlite')"` locally and check the `node:22-alpine` current minor ≥ 22.13 in its release notes. If it isn't usable, implement `SqliteAnalyticsStore` as the NDJSON-per-day plus daily JSON fallback the spec names, with the same interface. Record which in the commit message.
- [ ] **Step 2: Write failing tests,** run once per backend (`describe.each`). Seed visits and events across 3 UK days and check:
  - `summary('7d')` totals;
  - one visitor counted once per day;
  - reddit `subreddit:null` grouped separately from `r/WebGames`;
  - `joinsNearby` versus `joinsCode`, where `joinsCode = player_joined − nearby_join`, floored at 0;
  - `peakPlayers` is the max `notePlayersOnline`;
  - `busiestHour` is the UK hour with the most `player_joined`;
  - `prune` drops raw rows older than 90 days but the daily aggregates remain;
  - the notice round-trips, and `setNotice(null)` clears it.
  - **SQLite only:** close and reopen the same file, and the summary is unchanged (persistence).
  - **Privacy:** scan every stored row and column (SQLite `SELECT *` from every table; memory internals) for a test IP `203.0.113.7` and UA `TestAgent/1.0`, and assert none are found.
- [ ] **Step 3:** Run `npx vitest run server/platform/admin/store.test.ts`. Expect FAIL.
- [ ] **Step 4: Implement.** In SQLite, write raw rows to the tables `visits` and `events` and upsert daily aggregates into `daily(day, metric, key, value)` at write time, so pruning raw rows never loses totals. Also keep `peak(day, players)` and `notice` (one row).
- [ ] **Step 5:** Run again. Expect PASS.
- [ ] **Step 6: Commit** "Admin: analytics store, memory and SQLite, 90-day raw rows, daily totals kept".

### Task 3: Server wiring (room events, live rooms, beacon, public notice)

**Files:**
- Modify:
  - `server/platform/drivers/roomManager.ts` (`roomDeps().onChange` composes the checkpoint hook with a new option `onRoomChange?: (after: PlatformRoomData, before: PlatformRoomData | null) => void`, and a `liveRooms(): PlatformRoomData[]`);
  - `server/platform/drivers/types.ts` (`GameDriver.liveRooms(): MaybePromise<PlatformRoomData[]>`);
  - `memory.ts` and the redis driver (local rooms only);
  - `server/platform/app.ts` (`AppOptions.analytics?: AnalyticsStore`; routes);
  - `server/index.ts` (`openStore(process.env)`, prune daily, `close` on shutdown).
- Create: `server/platform/admin/beacon.ts`
- Test: `server/platform/admin/beacon.test.ts`, and additions to `server/platform/app.test.ts`

**Interfaces:**
- Consumes Tasks 1 and 2.
- Produces:
  - `POST /api/v` with body `{k:'view', path, ref, game, w}` or `{k:'join', via:'nearby'}`, answering 204;
  - `GET /api/notice` with `{ text: string } | {}`;
  - `driver.liveRooms()`;
  - `handleBeacon(req, store, salt, opts): void`.
- `onRoomChange` passes `before = null` for a room's first change after create. Restoring from a checkpoint must not emit `room_created`.
- The `/api` CORS block allows `POST` for `/api/v` only.
- The beacon's width `w` maps to `device`: under 760 is `phone`, under 1100 is `tablet`, otherwise `desktop`.

- [ ] **Step 1: Write failing tests.**
  - A created room emits `room_created` and `player_joined`, while a restored room emits none.
  - `liveRooms` lists open rooms.
  - A beacon with a Reddit referrer records one visit with the right source.
  - **Review Focus 4:**
    - a 3 KB body gives 204 and nothing recorded;
    - malformed JSON gives 204 and nothing recorded;
    - the 31st beacon in a minute from one network gives 204 and isn't recorded;
    - a bot UA isn't recorded.
  - `{k:'join', via:'nearby'}` records `nearby_join`.
  - `GET /api/notice`:
    - an expired notice gives `{}`;
    - the `on:false` notice gives `{}`;
    - the cached response updates within 30 s.
- [ ] **Step 2:** Run the new tests. Expect FAIL.
- [ ] **Step 3: Implement.** Also call `store.notePlayersOnline(count, now)` from `onRoomChange` with the total connected players across `liveRooms()`.
- [ ] **Step 4:** Run `npx vitest run server/platform`. Expect PASS, with existing tests unchanged.
- [ ] **Step 5: Commit** "Admin: count room events and visits; public notice endpoint".

### Task 4: Admin host, sessions and admin API

**Files:**
- Create: `server/platform/admin/session.ts`, `server/platform/admin/router.ts`
- Modify: `server/platform/app.ts` (mount `adminRouter` first, gated by host; `/admin*` on any other host is a 404; serve `dist/admin` static on the admin host)
- Test: `server/platform/admin/session.test.ts`, `server/platform/admin/router.test.ts`

**Interfaces:**
- Consumes Tasks 2 and 3 (`store`, `driver.liveRooms()`).
- Produces:
  - `signSession(key: Buffer, exp: number): string`;
  - `verifySession(key: Buffer, value: string, now: number): boolean`;
  - `sessionKey(password: string, secret: string): Buffer`;
  - `adminRouter({ store, driver, env, now }): Router`;
  - **Routes** (all on the admin host): `POST /api/admin/login {password}` gives 204 plus the cookie, 401, or 429 with `Retry-After`; `POST /api/admin/logout` gives 204 and clears the cookie; `GET /api/admin/summary?range=` gives `Summary`; `GET /api/admin/rooms` gives `{ rooms: { code, gameId, phase, connected, seated, spectators, ageMs }[] }`; `GET /api/admin/notice`; `PUT /api/admin/notice {text, on, expiresAt}` gives 204 or 400.
  - **Without a valid session:** the admin APIs return 401, except login.

- [ ] **Step 1: Write failing tests.**
  - Sign then verify round-trips. A tampered value fails, an expired value fails, and a changed password fails.
  - **Review Focus 3:** with no `ADMIN_PASSWORD`, `GET /` on the admin host serves the not-set-up page, and `POST /api/admin/login` returns 503.
  - A wrong password gives 401. After 5 failures, the next attempt gives 429 with `Retry-After: 1`.
  - The right password gives 204, and its cookie has `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age=2592000`, and **no `Domain`**.
  - `GET /api/admin/summary` without a cookie gives 401, and with it gives 200 in the `Summary` shape.
  - **Host gating:** `GET /api/admin/summary` with `Host: boredgames.io` gives 404, and `GET /admin` with the site host gives 404.
  - **Review Focus 5:** `PUT /api/admin/notice` with 141 characters gives 400, and with `<script>x</script>` it gives 204 and stores the text unchanged.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3: Implement.** Add `ADMIN_HOST`, `ADMIN_PASSWORD` and `ADMIN_SESSION_KEY` (with a dev fallback that's random per boot, logged as a warning) to the env reading.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5: Commit** "Admin: host-gated router, password sessions, admin API".

### Task 5: Admin UI

**Files:**
- Create: `vite.admin.config.ts` (root `admin/`, outDir `../dist/admin`), `admin/index.html`, and `admin/src/{main.tsx, api.ts, Login.tsx, Analytics.tsx, Rooms.tsx, Notice.tsx, BarChart.tsx, admin.css}`
- Modify: `package.json` (`build:admin` in `build`), the `tsconfig` include
- Test: `admin/src/admin.test.tsx` (vitest and react-dom/server render)

**Interfaces:**
- Consumes Task 4's routes and the `Summary` type, imported from `server/platform/admin/store.ts` through a shared type-only path. If the server types can't be imported, move them to `shared/platform/admin.ts`.

**What it contains:**
- **Layout:** a top bar with three tabs (Analytics, Live rooms, Notice) and Sign out. The site's tokens from `client/src/platform/styles` (import the tokens file). One column under 760px.
- **Analytics:**
  - range tabs (Today, 7 days, 30 days);
  - number tiles for visitors, rooms, players, games started and games finished;
  - an inline-SVG bar chart of visitors by day (no library);
  - tables: Sources (Reddit rows show the subreddit, or "Reddit (subreddit not given)"), Games, Deep links;
  - "Joined by tapping the room on the same Wi-Fi" versus "typed the code";
  - peak players and busiest hour.
- **Live rooms:** a table that polls every 5 s, with the code, game name, Lobby / Playing, players, watching and age ("12 min").
- **Notice:**
  - a text input with a 140-character counter, an On/Off switch, and an optional expiry date-time;
  - Save, then "Saved, it shows on the home page within a minute";
  - a live preview of the banner.
- **Login:** one password field and Sign in. Errors: "Wrong password", and "Too many tries, wait N seconds".

- [ ] **Step 1: Write failing render tests.**
  - The Analytics page renders a supplied `Summary` fixture, showing "Reddit (subreddit not given)" and "r/WebGames".
  - The Notice preview renders `<script>` as text.
  - Rooms renders "12 min" for `ageMs = 720000`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests and `npm run build`. Expect PASS and a `dist/admin/index.html` that exists.
- [ ] **Step 5: Commit** "Admin: dashboard UI (analytics, live rooms, notice, sign-in)".

### Task 6: Client beacon, Wi-Fi join beacon and notice banner

**Files:**
- Modify:
  - `client/src/main.tsx` (one `sendBeacon` per page load, skipped during prerender);
  - `client/src/platform/components/NearbyRooms.tsx` or its caller (beacon `{k:'join', via:'nearby'}` on Join);
  - `client/src/platform/screens/Home.tsx` (fetch `apiUrl('/api/notice')` after mount, show the banner above the code boxes);
  - CSS in `client/src/platform/styles/home.css`.
- Create: `client/src/platform/lib/beacon.ts`, `client/src/platform/components/NoticeBanner.tsx`
- Test: `client/src/platform/lib/beacon.test.ts`, `client/src/platform/components/notice.test.ts`

**Interfaces:**
- Produces `sendVisit(loc: Location, referrer: string, width: number): void` and `sendNearbyJoin(): void`. Both use `navigator.sendBeacon(apiUrl('/api/v'), new Blob([json], {type:'text/plain'}))`, fall back to `fetch(... {keepalive:true})`, and swallow errors.
- **Payload:** `{k:'view', path, ref: <?ref= value or null>, game: <?game= value or null>, w}` and `{k:'join', via:'nearby'}`.

- [ ] **Step 1: Write failing tests.**
  - `sendVisit` builds the payload from a URL with `?game=scribble&ref=sideproject`.
  - It never throws when `sendBeacon` is missing.
  - **Review Focus 5:** `NoticeBanner` renders `<a href=x>hi</a>` as literal text, and renders nothing for `{}`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3: Implement.** The banner is slim, one line, wraps without leaving a word alone, and uses the tokens with no em dashes.
- [ ] **Step 4:** Run `npx vitest run client/src/platform`. Expect PASS.
- [ ] **Step 5: Commit** "Client: visit beacon, Wi-Fi join beacon, home notice banner".

### Task 7: Deploy and e2e

**Files:**
- Modify:
  - `fly.toml` (`[mounts] source = "bg_data", destination = "/data"`; `[env] ANALYTICS_DB = "/data/analytics.db"`, `ADMIN_HOST = "admin.boredgames.io"`);
  - `.github/workflows/deploy-fly.yml` (create volume `bg_data` in `lhr` at 1 GB if missing; set `ADMIN_SESSION_KEY` like `ROOM_CHECKPOINT_KEY` if missing; `flyctl certs add admin.boredgames.io` when `flyctl certs show` says it's absent);
  - `Dockerfile` (the runtime has `dist/admin`; `COPY --from=build /app/dist ./dist` already covers it, so check);
  - the e2e launch config (`ADMIN_HOST=admin.localhost`, `ADMIN_PASSWORD=e2e-secret`, `ADMIN_SESSION_KEY=e2e-key`, `ANALYTICS_COUNT_HEADLESS=1`, `ANALYTICS_DB` in a temp dir for the restart case).
- Create: `e2e/admin.spec.ts`, `docs/ADMIN.md` (the owner's three steps, from the spec)

- [ ] **Step 1: Write `e2e/admin.spec.ts`.**
  - `http://admin.localhost:<port>/` without a cookie shows sign-in. A wrong password shows "Wrong password", and the right one shows Analytics.
  - Two phones open the site with `?game=scribble&ref=e2e`, and one creates a room the other joins from the same-Wi-Fi list (reuse `e2e/netProxy.ts`). Afterwards Analytics for Today shows 2 or more visitors, `ref:e2e` under Sources, a Scribble deep link, and 1 Wi-Fi join.
  - Live rooms lists the room's code within 6 s.
  - Saving the notice "Quick restart at 9pm" shows it on the site's Home within 35 s. Switching it off removes it.
  - After restarting the server (the pattern in `e2e/restart.spec.ts`) the Today visitors are unchanged.
- [ ] **Step 2:** Run it through `e2e-run.sh` with this spec only. Expect PASS once Tasks 1 to 6 are in.
- [ ] **Step 3:** Run `npm run check` and the full e2e suite once. Expect everything green.
- [ ] **Step 4: Commit** "Admin: deploy (volume, cert, secrets) and e2e".
