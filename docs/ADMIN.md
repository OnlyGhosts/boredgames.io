# The admin dashboard

`admin.boredgames.io`: analytics, live rooms and the home page notice, behind one password.
It is served by the game server on Fly (the same process that runs the rooms), and only on that
host: `boredgames.io` and the API never serve it, and players still get no cookies.

## Owner steps (once)

1. In the Fly dashboard, open the app `boredgames-io`, then **Secrets**, and add `ADMIN_PASSWORD`.
2. In the domain's DNS, add a CNAME: name `admin`, value `boredgames-io.fly.dev`.
3. Open `https://admin.boredgames.io` and sign in.

The deploy workflow does the rest: it creates the `bg_data` volume (1 GB, `lhr`) the analytics
live on, makes the `ADMIN_SESSION_KEY` secret once, and asks Fly for the `admin.boredgames.io`
certificate, which is issued once the CNAME exists. Without `ADMIN_PASSWORD` the admin host says
it is not set up and lets nobody in. Changing the password signs every session out.

## What it counts

- **Visits:** one beacon per page load (`POST /api/v`): the path, the referrer, any `?ref=` and
  `?game=`, and phone, tablet or desktop. A visitor is a salted hash of address and user agent;
  the salt is random, lives only in memory and changes at UK midnight, so no address or user agent
  is stored and one day's visitors cannot be linked to the next. Crawlers are not counted.
- **Rooms:** rooms created, players joined, games started and finished, joins from the same-Wi-Fi
  list, and the most players online at once, from what the server already sees.
- **Kept:** raw rows for 90 days, the daily totals for good, in SQLite at `ANALYTICS_DB`
  (`/data/analytics.db` on Fly). Without `ANALYTICS_DB` (local runs) it counts in memory.

## Running it locally

`npm run build`, then start the server with `ADMIN_HOST=admin.localhost ADMIN_PASSWORD=...` and
open `http://admin.localhost:3001` (browsers send `*.localhost` to the machine itself). Set
`ANALYTICS_COUNT_HEADLESS=1` to count a headless browser's visits (the e2e suite does).

## Where the code is

- `server/platform/admin/`: the analytics logic, the store (memory and SQLite), the beacon, the
  public notice, sessions and the host-gated router.
- `admin/`: the dashboard UI, its own Vite build (`npm run build:admin`, into `dist/admin`).
- `client/src/platform/lib/beacon.ts` and `components/NoticeBanner.tsx`: the beacon and the
  banner on Home.
