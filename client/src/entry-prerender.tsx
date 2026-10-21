/**
 * The Vite SSR entry the build uses to write the front door as real HTML (scripts/prerender.ts):
 * the app rendered to a string for a path, with the games registered as main.tsx registers them
 * and the store at its defaults. It runs in plain node, with no window; the client then hydrates
 * the markup (main.tsx), so the first render here must match the client's first render.
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { GAMES } from './games';
import { registerGames } from './platform/registry';
import { parseRoute, useRouter } from './platform/router';

registerGames(GAMES);

/** The markup of the app for `path`, as its first paint renders it. */
export function renderRoute(path: string): string {
  useRouter.setState({ route: parseRoute(path) });
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
