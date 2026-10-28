import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { MAX_WS_MESSAGE_BYTES } from '../../shared/platform/constants.js';
import { CLOSE_RESTARTING, ROOM_PREVIEW_PATH, WS_PATH } from '../../shared/platform/protocol.js';
import { isGameSlugPath, isRoomPath } from '../../shared/platform/roomCode.js';
import { NEARBY_PATH, type NearbyResponse } from '../../shared/platform/nearby.js';
import { DailySalt } from './admin/analytics.js';
import { BEACON_MAX_BYTES, BEACON_PATH, BEACON_PER_MINUTE, handleBeacon, readCappedBody } from './admin/beacon.js';
import { NOTICE_PATH, NoticeCache } from './admin/notice.js';
import { adminRouter } from './admin/router.js';
import type { AnalyticsStore } from './admin/store.js';
import { asSocketLike, handleConnection } from './connection.js';
import { listNearby } from './nearby/list.js';
import { clientAddress, networkKey } from './nearby/network.js';
import { after, type GameDriver } from './drivers/types.js';
import { KeyedRateLimiter } from './rateLimiter.js';

export interface AppOptions {
  driver: GameDriver;
  log?: (msg: string) => void;
  /** Serve the client build with an SPA fallback (off on Vercel, where the CDN serves the client). */
  serveStatic?: boolean;
  /** Where the client build lives; defaults to dist/client under the working directory. */
  clientDir?: string;
  /** Request paths that accept the WebSocket upgrade; defaults to WS_PATH. */
  wsPaths?: string[];
  /**
   * The host the site is the site on (CANONICAL_HOST, default boredgames.io). On any other host
   * (the Fly machine's own hostname) the pages ask not to be indexed and robots.txt disallows all,
   * so search engines never take that copy for the site.
   */
  canonicalHost?: string;
  /** Where visits, room events and the site notice are kept; without one the beacon is ignored and there is no notice. */
  analytics?: AnalyticsStore;
  /** Count headless browsers' visits (the e2e suite); defaults to ANALYTICS_COUNT_HEADLESS=1. */
  countHeadless?: boolean;
  /** The clock for the analytics and the notice (tests). */
  now?: () => number;
  /** ADMIN_HOST, ADMIN_PASSWORD and ADMIN_SESSION_KEY come from here; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Where the admin dashboard's build lives; defaults to dist/admin under the working directory. */
  adminDir?: string;
}

export interface App {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  /**
   * Before a restart: hands every phone holding a room checkpoint a fresh one, closes every socket
   * as restarting, then the driver and the listener. Done within about a second.
   */
  shutdown: () => Promise<void>;
}

/** How long a shutdown waits for the sockets to finish closing before it cuts the rest off. */
export const SHUTDOWN_CLOSE_WAIT_MS = 1000;

/** Routing, static files, health, room previews and the WebSocket upgrade shared by every entry point. */
export function createApp(options: AppOptions): App {
  const { driver } = options;
  const log = options.log ?? (() => undefined);
  const wsPaths = options.wsPaths ?? [WS_PATH];
  const canonicalHost = options.canonicalHost ?? process.env.CANONICAL_HOST ?? 'boredgames.io';
  const now = options.now ?? (() => Date.now());
  const analytics = options.analytics ?? null;
  const countHeadless = options.countHeadless ?? process.env.ANALYTICS_COUNT_HEADLESS === '1';
  const visitorSalt = new DailySalt(now);
  const beaconLimiter = new KeyedRateLimiter(BEACON_PER_MINUTE, 60_000, 10_000);
  const notices = analytics ? new NoticeCache(analytics, now) : null;
  const env = options.env ?? process.env;
  const adminHost = (env.ADMIN_HOST || 'admin.boredgames.io').toLowerCase();

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // The admin dashboard answers on its own host only (and only where the analytics live); on any
  // other host its paths do not exist, so no admin page or cookie ever comes from the site.
  const admin =
    analytics && notices
      ? adminRouter({ store: analytics, driver, env, now, notices, dir: options.adminDir ?? path.resolve(process.cwd(), 'dist/admin'), networkOf: (req) => networkOf(req), log })
      : null;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.hostname === adminHost) {
      if (admin) return admin(req, res, next);
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    if (/^\/(api\/)?admin/i.test(req.path)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    next();
  });

  // The site can be served from another host than this server (Vercel's CDN in front of one Fly.io
  // machine), so the read-only /api endpoints answer any origin, and the visit beacon takes a POST
  // from it. WebSocket upgrades need no CORS.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Methods', `${req.baseUrl}${req.path}` === BEACON_PATH ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'accept, content-type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
  });

  // Handlers return the driver's promise (if any) so Express 5 routes a rejection to its error handler.
  app.get('/api/health', (_req: Request, res: Response) =>
    after(driver.health(), (health) => {
      res.json({ ok: true, ...health });
    }),
  );

  app.get(`${ROOM_PREVIEW_PATH}/:code`, (req: Request<{ code: string }>, res: Response) =>
    after(driver.preview(req.params.code), (preview) => {
      res.json(preview);
    }),
  );

  /** The salted hash of the network a request came from; the address itself goes no further. */
  const networkOf = async (req: IncomingMessage): Promise<string | null> => {
    const address = clientAddress(req);
    return address ? networkKey(address, await driver.nearby.salt()) : null;
  };

  // The rooms created on the asker's network. Never cached: the list changes as rooms start.
  app.get(NEARBY_PATH, async (req: Request, res: Response) => {
    const now = Date.now();
    const network = await networkOf(req);
    const body: NearbyResponse = { rooms: network ? await listNearby(driver, driver.nearby, network) : [], now };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  // One per page load: always 204, whatever was sent (see admin/beacon.ts).
  app.post(BEACON_PATH, async (req: Request, res: Response) => {
    const body = await readCappedBody(req, BEACON_MAX_BYTES);
    try {
      if (analytics) {
        const origin = typeof req.headers.origin === 'string' ? hostOf(req.headers.origin) : null;
        handleBeacon(
          { body, address: clientAddress(req) ?? req.socket.remoteAddress ?? '', userAgent: req.get('user-agent') ?? '', network: (await networkOf(req)) ?? 'local' },
          analytics,
          visitorSalt,
          { now: now(), countHeadless, siteHosts: [canonicalHost, req.hostname, ...(origin ? [origin] : [])], limiter: beaconLimiter },
        );
      }
    } catch (err) {
      log(`beacon: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.status(204).end();
  });

  // The home page's notice, asked for on each load; the store is read at most every 30 seconds.
  app.get(NOTICE_PATH, async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(notices ? await notices.current() : {});
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  if (options.serveStatic ?? true) {
    const clientDir = options.clientDir ?? path.resolve(process.cwd(), 'dist/client');
    if (existsSync(path.join(clientDir, 'index.html'))) {
      // A build from before the prerender has no 404 page: the shell with a 404 status does then.
      const notFoundPage = existsSync(path.join(clientDir, '404.html')) ? '404.html' : 'index.html';
      app.use((req: Request, res: Response, next: NextFunction) => {
        // A local run (dev, the e2e suite) is the site itself, not a copy of it.
        if (req.hostname === canonicalHost || req.hostname === 'localhost' || req.hostname === '127.0.0.1') return next();
        if (req.path === '/robots.txt') {
          res.type('text/plain').send('User-agent: *\nDisallow: /\n');
          return;
        }
        res.setHeader('X-Robots-Tag', 'noindex');
        next();
      });
      // index.html is checked with the server every time and version.json never stored, so a tab
      // reloading for a new version (client lib/update.ts) gets it; hashed assets keep the hour.
      app.use(
        express.static(clientDir, {
          index: 'index.html',
          maxAge: '1h',
          setHeaders: (res, file) => {
            if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
            else if (file.endsWith('version.json')) res.setHeader('Cache-Control', 'no-store');
          },
        }),
      );
      // Room links such as https://host/scribble/XK4P load the app (never indexed: a room is not a
      // page); any other unknown path is a real 404 carrying the 404 page, where the app still
      // mounts and shows the front door. The same shapes as vercel.json's rewrites.
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api') || wsPaths.some((p) => req.path.startsWith(p))) return next();
        if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next(); // missing asset, not a route
        res.setHeader('Cache-Control', 'no-cache');
        // `root` keeps the path relative: an absolute path would make sendFile apply its dotfiles
        // policy to every directory on the way and 404 from a checkout under a dot-directory.
        const file = { root: clientDir, dotfiles: 'allow' } as const;
        if (isRoomPath(req.path)) {
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          res.sendFile('index.html', file);
        } else if (isGameSlugPath(req.path)) {
          // The old per-game landing pages: the front door, as Vercel's redirect sends them.
          res.redirect(308, '/');
        } else {
          res.status(404).sendFile(notFoundPage, file);
        }
      });
      log(`serving client from ${clientDir}`);
    } else {
      log('no client build found in dist/client; API + WebSocket only (use Vite for the client)');
    }
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });

  // Set once a shutdown begins: a phone reconnecting after its restarting close must reach the next
  // process, not this one, whose rooms are already gone.
  let closing = false;

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (closing) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!wsPaths.includes(pathname)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Hashed only if the socket creates a room.
      handleConnection(asSocketLike(ws), { driver, log, network: () => networkOf(req) });
    });
  });

  const shutdown = async (): Promise<void> => {
    closing = true;
    // No new connections from here on; the open ones get their checkpoints and the close first.
    const listenerClosed = new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    try {
      await driver.checkpointAll();
    } catch (err) {
      log(`checkpoints before shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Queued behind the checkpoints on each socket, so the phones get those first.
    for (const client of wss.clients) client.close(CLOSE_RESTARTING, 'Server restarting');
    await driver.shutdown();
    await closedOrTimedOut(wss, SHUTDOWN_CLOSE_WAIT_MS);
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections();
    await listenerClosed;
  };

  return { app, server, wss, shutdown };
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/** Resolves once every socket of `wss` has closed, or after `ms`. */
function closedOrTimedOut(wss: WebSocketServer, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    const poll = setInterval(() => {
      if (wss.clients.size === 0) done();
    }, 20);
    function done(): void {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    }
    if (wss.clients.size === 0) done();
  });
}
