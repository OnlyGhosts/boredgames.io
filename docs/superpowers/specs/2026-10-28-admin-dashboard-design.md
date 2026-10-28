# Admin dashboard: design

Approved in chat by the owner on 28 Oct 2026. An admin site for boredgames.io with three pages:
analytics, live rooms, and a site notice.

## Goal

The owner can see how the site is used (above all during the Reddit launch week), what is
happening right now, and put a short notice on the home page. All of it without adding cookies,
accounts or tracking for players.

## Where it lives and who gets in

- **Address:** `admin.boredgames.io`, served by the game server on Fly (the same process and app
  that runs the rooms). The server answers admin routes only when the request's host is the admin
  host. `boredgames.io` and the API never serve them.
- **DNS:** one CNAME, `admin` → `boredgames-io.fly.dev`. The owner adds it where the domain's DNS
  is managed. The deploy workflow runs `flyctl certs add admin.boredgames.io` (idempotent), so the
  certificate is issued once the record exists.
- **Password:** a Fly secret, `ADMIN_PASSWORD`, set by the owner in the Fly dashboard. If it isn't
  set, the admin host says so and lets nobody in.
- **Sign-in:**
  - The login form posts the password. The server compares it in constant time.
  - On success the server sets a signed session cookie for 30 days, scoped to the admin host only:
    `HttpOnly`, `Secure`, `SameSite=Strict`. The signing key comes from the password plus a
    server key, so changing the password signs everyone out.
  - Wrong guesses are rate-limited per network: after 5 failures, a growing delay.
  - Sign out clears the cookie.
- **No admin cookie ever reaches `boredgames.io`.** Players still get no cookies.

## Pages

### Analytics
- **Ranges:** today, 7 days, 30 days, plus a by-day chart for the range.
- **Visitors:** unique visitors per day and page views.
- **Sources:**
  - referrer domains;
  - for reddit.com, the subreddit taken from the referrer path (`/r/WebGames/...` → `r/WebGames`);
  - `?game=` deep-link landings, by game;
  - direct traffic.
- **Activity:**
  - rooms created, players joined, games started and games finished, each per game;
  - average players per room;
  - joins from the same-Wi-Fi list versus a typed code;
  - peak simultaneous players, and busiest hour of the day (UK time).

### Live rooms
Every room open right now: code, game, phase (lobby, playing, results), players connected and
seated, spectators, and age. It refreshes every 5 seconds. Read only.

### Site notice
- One notice: text (up to 140 characters, plain text, no links), on or off, and an optional
  expiry.
- The home page shows it as a slim banner above the code boxes when it's on.
- Saving takes effect within a minute: the home page asks for the notice when it loads, and the
  server caches it.

## How visits are counted (no cookies, no stored IPs)

- **The beacon:** when a page first loads, the client sends one small request,
  `POST /api/v` (with `navigator.sendBeacon` where available). It carries the path, the
  referrer, the `?game=` value if any, and the viewport width bucket (phone, tablet or desktop).
- **Unique visitors:** the server counts a visitor with a daily key,
  `sha256(daily salt + IP + user agent)`. The salt is random, rotates at UK midnight, is kept only
  in memory and is never written to disk. The IP and user agent are never stored, and yesterday's
  keys can't be linked to today's. This is the method Plausible and Fathom use.
- **Game activity:** counted on the server from events the engine already sees: room created,
  player joined (and how), game started and game ended. These aren't tied to any visitor.
- **Bots:** requests whose user agent says bot, crawler or spider aren't counted, which covers the
  prerender and Googlebot visits.
- **The site keeps working without it.** If the beacon fails, nothing changes for the player.

## Storage

- **Disk:** a Fly volume (1 GB, region `lhr`), mounted at `/data`, attached to the single machine.
  The deploy workflow creates it if it's missing. `fly.toml` gains the `[mounts]` entry.
- **Format:** SQLite through Node's built-in `node:sqlite`, so no new native dependency. If
  `node:sqlite` turns out to be unusable on the deployed Node 22 image, the fallback is an
  append-only NDJSON file per day plus a daily summary JSON. The builder confirms which before
  building on it.
- **What's kept:**
  - daily aggregate counts, kept forever;
  - the raw visit and event rows, kept for 90 days and then pruned;
  - the notice, as one row.
- **Without a disk** (local dev and tests), it runs in memory with the same interface.

## Where the code goes

- `server/platform/admin/`: host routing, auth, the analytics store (an interface with SQLite and
  memory backends), event hooks, and the routes. The pages are served as one small static bundle.
- **The admin UI:** its own small Vite entry, `admin.html`, in the client build, served by the
  server. It reuses the site's design tokens, with one column on phones.
- **The client:** the beacon in the platform boot, and the notice banner on the home screen.
- **Copy rules:** no em dashes, curly apostrophes, never a single word alone on a line.

## Testing

- **Unit:**
  - session sign and verify, and password compare;
  - rate limiting;
  - parsing the subreddit from a referrer;
  - the daily key rotating, and no IP ever reaching the store (a test reads every stored row);
  - rolling events up into daily aggregates;
  - the notice's expiry;
  - bot filtering.
- **e2e:**
  - the admin host refuses access without the cookie;
  - the login works and a wrong password is refused;
  - after a few page loads and a played room, the analytics page shows them;
  - the live rooms page lists an open room;
  - saving a notice shows the banner on the home page;
  - counts survive a server restart (file-backed store in the e2e run).
- The usual full check and full e2e run before the push.

## Owner steps after the push

1. In the Fly dashboard, open the app, then Secrets, and add `ADMIN_PASSWORD`.
2. In the domain's DNS, add a CNAME: name `admin`, value `boredgames-io.fly.dev`.
3. Open `admin.boredgames.io` and sign in.

## Out of scope

Closing rooms or removing players, other admins or roles, Vercel Web Analytics, and emailed
reports.
