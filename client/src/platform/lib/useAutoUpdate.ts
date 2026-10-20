import { useEffect } from 'react';
import { usePlatformStore } from '../store/usePlatformStore';
import { loadReloadedFor, saveReloadedFor } from './storage';
import { BUILD_ID, CHECK_EVERY_MS, decideUpdate, fetchLatest, isInGame, type UpdateDecision } from './update';
import { isTypingTarget } from './useViewport';

/**
 * Reloads the tab once a new version is live, at a safe moment (see `decideUpdate`). It asks when the
 * tab comes back into view, when the connection comes back after a drop, and every CHECK_EVERY_MS
 * while visible. While it waits, the moments it waits for (the game ending, the field being left,
 * the tab going to the background) ask again, so every reload follows a fresh answer. The last
 * decision is on <html data-update> for the e2e spec; nothing shows on screen.
 */
export function useAutoUpdate(): void {
  useEffect(() => {
    if (!BUILD_ID) return;
    let waiting = false;
    let checking = false;
    let again = false;
    let stopped = false;

    const decide = (latest: string | null): UpdateDecision => {
      let decision = decideUpdate({
        current: BUILD_ID,
        latest,
        reloadedFor: loadReloadedFor(),
        inGame: isInGame(usePlatformStore.getState().room),
        typing: isTypingTarget(document.activeElement),
        hidden: document.visibilityState === 'hidden',
      });
      // A tab that cannot remember the reload must not make it: it could reload for ever.
      if (decision === 'reload' && latest !== null && !saveReloadedFor(latest)) decision = 'leave';
      return decision;
    };

    const check = async (): Promise<void> => {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      const latest = await fetchLatest();
      checking = false;
      if (stopped) return;
      const decision = decide(latest);
      waiting = decision === 'wait';
      document.documentElement.dataset.update = decision;
      if (decision === 'reload') {
        window.location.reload();
        return;
      }
      if (again) {
        again = false;
        void check();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' || waiting) void check();
    };
    const onFocusOut = () => {
      if (waiting) void check();
    };
    const stopStore = usePlatformStore.subscribe((s, prev) => {
      const back = s.connection === 'connected' && (prev.connection === 'reconnecting' || prev.connection === 'restarting');
      const gameOver = waiting && isInGame(prev.room) && !isInGame(s.room);
      if (back || gameOver) void check();
    });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      stopped = true;
      stopStore();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
}
