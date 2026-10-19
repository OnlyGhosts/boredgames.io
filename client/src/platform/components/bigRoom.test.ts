/**
 * A full room of 50: the lobby, the players sheet and the results list every player, each long
 * list scrolling inside its own panel, and the game picker reads out each game's seat range.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GameId } from '@shared/platform/games';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { ROOM_HARD_CAP } = await import('@shared/platform/settings');
const { player, resetStore, room } = await import('../../test/fixtures');
const { GamePicker } = await import('./GamePicker');
const { PlayerList } = await import('./PlayerList');
const { ResultsPopup } = await import('./ResultsPopup');
const { Lobby } = await import('../screens/Lobby');
const { listCap, restForList, roomForList } = await import('../lib/useListRoom');

const ids = Array.from({ length: ROOM_HARD_CAP }, (_, i) => (i === 0 ? 'host' : `p${i}`));
const full = (overrides: Parameters<typeof room>[0] = {}) => room({ players: ids.map((id, i) => player(id, { joinOrder: i, score: (ROOM_HARD_CAP - i) * 10 })), ...overrides });
const rows = (html: string) => html.match(/data-testid="player-item"/g)?.length ?? 0;

function ruleOf(css: string, selector: string): string {
  const block = css.match(new RegExp(`\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1];
  if (block === undefined) throw new Error(`no rule for ${selector}`);
  return block;
}

function stylesheet(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), 'utf8');
}

beforeEach(() => resetStore());

describe('a full room of 50', () => {
  it('lists all 50 in the lobby, in a list that scrolls on its own in whole rows so the settings stay close', () => {
    expect(ROOM_HARD_CAP).toBe(50);
    expect(rows(renderToString(createElement(Lobby, { room: full(), game: null })))).toBe(50);
    const list = ruleOf(stylesheet('lobby.css'), '.lobby__players .player-list');
    expect(list).toContain('max-height: var(--list-cap, none)');
    expect(list).toContain('overflow-y: auto');
    // Fifty rows never fit a window with Start under them: the list is capped, on a phone (Start pinned under 844px, the list
    // 446px down the page) as on a desktop (the host's list 418px down), inside the room under its top at the page's rest.
    const bottoms = Array.from({ length: ROOM_HARD_CAP }, (_, i) => 53 * (i + 1));
    for (const [view, top, below] of [[844, 446, 134], [900, 418, 126], [1080, 418, 126]]) {
      const cap = listCap({ room: roomForList(view, below), rest: restForList(view, top, below), rowBottoms: bottoms, border: 1 });
      expect(cap, `${view}px`).not.toBeNull();
      expect(cap ?? 0, `${view}px`).toBeLessThanOrEqual(restForList(view, top, below));
    }
    expect(ruleOf(stylesheet('lobby.css'), '.lobby__players .player')).toContain('flex: none');
  });

  it('lists all 50 in the players sheet and in the results, each scrolling inside its panel', () => {
    expect(rows(renderToString(createElement(PlayerList, { room: full({ phase: 'playing' }), meId: 'host', isHost: true, mode: 'game', game: null })))).toBe(50);
    const entries = ids.map((playerId, i) => ({ playerId, name: playerId, avatar: { color: 0, emoji: 0 }, score: (ROOM_HARD_CAP - i) * 10, rank: i + 1 }));
    const html = renderToString(createElement(ResultsPopup, { results: { id: 'r', gameId: 'scribble', reason: 'finished', entries }, meId: 'p49', onClose: () => undefined }));
    expect(html.match(/data-testid="results-entry"/g)).toHaveLength(50);
    expect(html).toContain('You came 50th');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.sheet__body')).toContain('overflow-y: auto');
    expect(ruleOf(css, '.results-card__scroll')).toContain('overflow-y: auto');
  });

  it("reads out each game’s seat range: no cap for Blackjack and Quip Game, 2 to 23 for Poker", () => {
    // The line's text, the count's own span (it never breaks inside the count) stripped.
    const metaOf = (gameId: GameId) =>
      renderToString(createElement(GamePicker, { room: room({ gameId }), isHost: true, game: null }))
        .replace(/<!-- -->/g, '')
        .match(/data-testid="game-picker-meta">(.*?)<\/p>/)?.[1]
        .replace(/<[^>]+>/g, '');
    expect(metaOf('poker')).toBe('Poker · 2 to 23 players');
    expect(metaOf('blackjack')).toBe('Blackjack · 1+ players');
    expect(metaOf('quipgame')).toBe('Quip Game · 3+ players');
  });
});
