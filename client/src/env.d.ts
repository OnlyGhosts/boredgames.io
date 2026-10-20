/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the game server (https://…) when it is not the site's own; see net/server.ts. */
  readonly VITE_GAME_SERVER?: string;
}

/** This build's id, stamped by `vite build` (scripts/buildStamp.ts); not defined in dev or tests. */
declare const __BUILD_ID__: string | undefined;
