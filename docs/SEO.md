# Search engines

What the site gives crawlers, what the owner does once, and what to check after a deploy. The
design is in `docs/superpowers/specs/2026-10-21-seo-invisible-layer-design.md`: nothing new on
screen, real HTML for the front door, one URL per page, room links out of the index.

## Once, by the owner

1. Google Search Console (search.google.com/search-console): Add property, the Domain kind,
   `boredgames.io`. Add the TXT record it gives you where the domain's DNS lives, then Verify.
   Leave the record in place for good.
2. Sitemaps: submit `https://boredgames.io/sitemap.xml`.
3. URL inspection on `https://boredgames.io/`: Test live URL, check the screenshot shows the front
   door, then Request indexing.
4. Bing Webmaster Tools (bing.com/webmasters): Import from Google Search Console.
5. After a week: Pages, Not indexed. Room links listed as "Excluded by noindex" are right; nothing
   should be listed as "Soft 404".

## After every deploy

```sh
curl -s https://boredgames.io/ | grep -o '<title>[^<]*</title>'           # the home title
curl -sI https://boredgames.io/nope/path | head -1                         # 404
curl -sI https://boredgames.io/scribble | grep -i '^location'              # /
curl -sI https://boredgames.io/scribble/ZZZZ | grep -i x-robots-tag        # noindex, nofollow
curl -sI https://boredgames.io/SPYGAME/zzzz | head -1                      # 404 on Vercel (the app still opens the room)
curl -s https://boredgames.io/robots.txt                                   # Allow: /, the sitemap line
curl -s https://boredgames.io/sitemap.xml                                  # one <url> per public page
curl -sI "https://boredgames.io$(curl -s https://boredgames.io/ | grep -o '/assets/[^"]*\.js' | head -1)" | grep -i cache-control   # immutable
curl -s https://boredgames-io.fly.dev/robots.txt                           # Disallow: /
```

## Faster indexing

`.github/workflows/indexnow.yml` pings IndexNow (Bing, Yandex, Naver, Seznam) with the sitemap's
URLs on every push to `main`; the key file is `client/public/<key>.txt`. Google is not a
participant: it reads the sitemap and Search Console.

## What is deliberately not here

No analytics, no banner, no content pages, no per-game pages, no structured data for things not on
the page, no hidden text. The research report (`reports/Boredgames SEO organic traffic.md` in the
owner's files) says what pages with real text would add; that is a separate decision.
