// Tells IndexNow (shared by Bing, Yandex, Naver and Seznam; Google takes no part, its path is the
// sitemap and Search Console) that the site's pages changed: every URL of the live sitemap. Run by
// .github/workflows/indexnow.yml after a push to main. No secret: the key is public by design and
// served at https://boredgames.io/<key>.txt from client/public.
import { readdirSync } from 'node:fs';

const HOST = 'boredgames.io';

const key = readdirSync(new URL('../client/public/', import.meta.url))
  .find((file) => /^[0-9a-f]{32}\.txt$/.test(file))
  ?.replace(/\.txt$/, '');
if (!key) {
  console.error('indexnow: no key file in client/public');
  process.exit(1);
}

const sitemap = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urlList.length === 0) {
  console.error('indexnow: the live sitemap lists no URLs');
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList }),
});
console.log(`indexnow: ${res.status} for ${urlList.join(', ')}`);
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
