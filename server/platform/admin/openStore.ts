import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SqliteAnalyticsStore } from './sqliteStore.js';
import { MemoryAnalyticsStore, type AnalyticsStore } from './store.js';

/**
 * The analytics store the environment asks for: SQLite at ANALYTICS_DB (the Fly volume), in
 * memory without it. A file that cannot be opened (the volume missing, say) falls back to memory
 * with a warning: the game server never fails to start over its analytics.
 */
export function openStore(env: NodeJS.ProcessEnv, log: (msg: string) => void = () => undefined): AnalyticsStore {
  const file = env.ANALYTICS_DB?.trim();
  if (!file) {
    log('analytics: in memory (ANALYTICS_DB is not set)');
    return new MemoryAnalyticsStore();
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const store = new SqliteAnalyticsStore(file);
    log(`analytics: ${file}`);
    return store;
  } catch (err) {
    log(`WARNING: analytics database ${file} could not be opened (${err instanceof Error ? err.message : String(err)}); counting in memory until the next restart`);
    return new MemoryAnalyticsStore();
  }
}
