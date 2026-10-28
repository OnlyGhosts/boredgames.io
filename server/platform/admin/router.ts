/**
 * Everything the admin host (ADMIN_HOST, admin.boredgames.io) answers: the dashboard's static
 * build, sign-in and sign-out, and the JSON the dashboard reads. app.ts sends a request here only
 * when its host is the admin host, so the site and its API never serve any of it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { NOTICE_MAX_LENGTH, RANGES, type LiveRoom, type LiveRoomsResponse, type Range } from '../../../shared/platform/admin.js';
import type { GameDriver } from '../drivers/types.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { NoticeCache } from './notice.js';
import { LoginLimiter, SESSION_COOKIE, SESSION_MAX_AGE_S, passwordMatches, sessionKey, signSession, verifySession } from './session.js';
import type { AnalyticsStore } from './store.js';

export interface AdminRouterOptions {
  store: AnalyticsStore;
  driver: GameDriver;
  /** Reads ADMIN_PASSWORD and ADMIN_SESSION_KEY. */
  env: NodeJS.ProcessEnv;
  now: () => number;
  /** The public notice cache, refreshed the moment a notice is saved. */
  notices: NoticeCache;
  /** The dashboard build (dist/admin). */
  dir: string;
  /** The salted network key of a request, null on the machine itself. */
  networkOf: (req: Request) => Promise<string | null>;
  log: (msg: string) => void;
}

const NOT_SET_UP_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Admin not set up</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f3ee; color: #23201c; }
  main { max-width: 28rem; text-wrap: pretty; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; text-wrap: balance; }
  code { font-size: .95em; }
  @media (prefers-color-scheme: dark) { body { background: #1d1b18; color: #f1ece4; } }
</style>
</head>
<body>
<main>
<h1>The admin dashboard is not set up yet</h1>
<p>Add a secret called <code>ADMIN_PASSWORD</code> to the Fly app, then reload this page to&nbsp;sign&nbsp;in.</p>
</main>
</body>
</html>
`;

const noticeInput = z.object({
  text: z.string().max(1000),
  on: z.boolean(),
  expiresAt: z.number().int().positive().nullable(),
});

/** The notice as saved: whitespace runs (a pasted line break) become one space. */
export function cleanNoticeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The notice's length as a person counts it: an emoji is one character. */
export function noticeLength(text: string): number {
  return [...text].length;
}

/** One open room as the Live rooms page shows it. */
export function liveRoom(data: PlatformRoomData, now: number): LiveRoom {
  const playing = data.phase === 'playing';
  const spectators = playing ? data.players.filter((p) => !p.participating).length : 0;
  return {
    code: data.code,
    gameId: data.gameId,
    phase: playing ? 'playing' : data.results ? 'results' : 'lobby',
    connected: data.players.filter((p) => p.connected).length,
    seated: data.players.length - spectators,
    spectators,
    ageMs: Math.max(0, now - data.createdAt),
  };
}

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function sessionCookie(value: string, maxAge: number): string {
  // No Domain attribute: the cookie stays on the admin host and never reaches boredgames.io.
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function adminRouter(o: AdminRouterOptions): Router {
  const router = Router();
  const password = o.env.ADMIN_PASSWORD ?? '';

  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  if (!password) {
    o.log('admin: ADMIN_PASSWORD is not set, so the admin host lets nobody in');
    router.use('/api', (_req: Request, res: Response) => {
      res.status(503).json({ error: 'ADMIN_PASSWORD is not set' });
    });
    router.use((_req: Request, res: Response) => {
      res.status(503).type('html').send(NOT_SET_UP_PAGE);
    });
    return router;
  }

  let secret = o.env.ADMIN_SESSION_KEY?.trim();
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    o.log('WARNING: ADMIN_SESSION_KEY is not set; admin sessions end when the server restarts');
  }
  const key = sessionKey(password, secret);
  const limiter = new LoginLimiter();
  const json = express.json({ limit: '4kb' });

  router.post('/api/admin/login', json, async (req: Request, res: Response) => {
    const network = (await o.networkOf(req)) ?? 'local';
    const now = o.now();
    const check = limiter.check(network, now);
    if (!check.ok) {
      res.setHeader('Retry-After', String(check.retryAfterS));
      res.status(429).json({ error: 'too many tries', retryAfterS: check.retryAfterS });
      return;
    }
    const body = req.body as { password?: unknown } | undefined;
    const given = typeof body?.password === 'string' ? body.password : '';
    if (!passwordMatches(given, password)) {
      limiter.fail(network, now);
      res.status(401).json({ error: 'wrong password' });
      return;
    }
    limiter.succeed(network);
    res.setHeader('Set-Cookie', sessionCookie(signSession(key, now + SESSION_MAX_AGE_S * 1000), SESSION_MAX_AGE_S));
    res.status(204).end();
  });

  // Clearing a cookie needs no session: an expired one signs out too.
  router.post('/api/admin/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.status(204).end();
  });

  router.use('/api/admin', (req: Request, res: Response, next: NextFunction) => {
    if (verifySession(key, cookieValue(req, SESSION_COOKIE) ?? '', o.now())) return next();
    res.status(401).json({ error: 'sign in first' });
  });

  router.get('/api/admin/summary', async (req: Request, res: Response) => {
    const range = (typeof req.query.range === 'string' ? req.query.range : 'today') as Range;
    if (!RANGES.includes(range)) {
      res.status(400).json({ error: 'range is today, 7d or 30d' });
      return;
    }
    res.json(await o.store.summary(range, o.now()));
  });

  router.get('/api/admin/rooms', async (_req: Request, res: Response) => {
    const now = o.now();
    const rooms = (await o.driver.liveRooms()).map((r) => liveRoom(r, now)).sort((a, b) => a.ageMs - b.ageMs);
    const body: LiveRoomsResponse = { rooms };
    res.json(body);
  });

  router.get('/api/admin/notice', async (_req: Request, res: Response) => {
    res.json({ notice: await o.store.getNotice() });
  });

  router.put('/api/admin/notice', json, async (req: Request, res: Response) => {
    const parsed = noticeInput.safeParse(req.body);
    const text = parsed.success ? cleanNoticeText(parsed.data.text) : '';
    if (!parsed.success || noticeLength(text) < 1 || noticeLength(text) > NOTICE_MAX_LENGTH) {
      res.status(400).json({ error: `The notice is 1 to ${NOTICE_MAX_LENGTH} characters of text.` });
      return;
    }
    await o.store.setNotice({ text, on: parsed.data.on, expiresAt: parsed.data.expiresAt, updatedAt: o.now() });
    o.notices.invalidate();
    res.status(204).end();
  });

  router.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  router.use(express.static(o.dir, { index: 'index.html', cacheControl: false }));

  router.use((req: Request, res: Response) => {
    const index = path.join(o.dir, 'index.html');
    if ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/' && existsSync(index)) {
      res.sendFile('index.html', { root: o.dir, dotfiles: 'allow' });
      return;
    }
    res.status(404).type('text/plain').send(existsSync(index) ? 'Not found' : 'The admin dashboard is not built: run npm run build.');
  });

  return router;
}
