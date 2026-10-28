import { WS_PATH } from '../shared/platform/protocol.js';
import { roomChangeRecorder } from './platform/admin/hooks.js';
import { openStore } from './platform/admin/openStore.js';
import { createApp } from './platform/app.js';
import { createDriverFromEnv } from './platform/drivers/select.js';
import type { GameDriver } from './platform/drivers/types.js';

/**
 * Standalone entry (`npm start`, the Dockerfile, `npm run dev`): one process serving the client,
 * /api and /ws. Rooms live in memory unless REDIS_URL (or KV_URL) points at a Redis, in which case
 * any number of these processes can share the rooms.
 */
const PORT = Number(process.env.PORT ?? 3001);
const log = (msg: string): void => console.log(`[bored-games] ${msg}`);

// Visits, room events and the site notice: SQLite on the Fly volume (ANALYTICS_DB), memory otherwise.
const analytics = openStore(process.env, log);
const driver: GameDriver = createDriverFromEnv({ log, onRoomChange: roomChangeRecorder(analytics, () => driver.liveRooms()) });
const { server, shutdown } = createApp({ driver, log, analytics });

// Raw visit and event rows go after 90 days; the daily totals stay.
const prune = (): void => {
  analytics.prune(Date.now()).catch((err: unknown) => log(`analytics prune: ${err instanceof Error ? err.message : String(err)}`));
};
prune();
setInterval(prune, 6 * 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT} (ws at ${WS_PATH})`);
});

let shuttingDown = false;
function stop(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, shutting down`);
  shutdown()
    .then(() => analytics.close())
    .then(() => {
      log('closed');
      process.exit(0);
    })
    .catch((err: unknown) => {
      log(`shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  // Force exit if lingering connections keep the server alive; well inside fly.toml's kill_timeout.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
