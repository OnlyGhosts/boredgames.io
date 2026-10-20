import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

/** Written next to index.html; the client compares its own build id with this file's to notice a new version. */
export const VERSION_FILE = 'version.json';

function gitHead(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * The id a build is stamped with: Vercel's commit SHA when it builds, else the checkout's HEAD,
 * else the build time (a Docker build has no .git).
 */
export function resolveBuildId(
  env: Record<string, string | undefined> = process.env,
  git: () => string | null = gitHead,
  now: () => number = Date.now,
): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (sha) return sha;
  return git() ?? `t${now()}`;
}

/**
 * Stamps `vite build`: `__BUILD_ID__` in the bundle and the same id in `version.json`. The dev
 * server gets no id, and with no id the client never checks for a new version.
 */
export function buildStamp(resolve: () => string = resolveBuildId): Plugin {
  let id = '';
  return {
    name: 'build-stamp',
    config(_config, { command }) {
      if (command !== 'build') return;
      id = resolve();
      return { define: { __BUILD_ID__: JSON.stringify(id) } };
    },
    generateBundle() {
      if (id) this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: `${JSON.stringify({ id })}\n` });
    },
  };
}
