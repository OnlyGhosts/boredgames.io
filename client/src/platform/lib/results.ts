/**
 * When the end-of-game results show: once per finished game, over the lobby, to the players who
 * took part and to anyone who was watching when it ended (a late tab, a reconnect or a reload
 * included: `shownId` is the results this tab had up and not closed), never to a newcomer who
 * joins the lobby afterwards, and never again once closed.
 */
import type { GameResults, ResultEntry, RoomState } from '@shared/platform/protocol';
import type { ScoreUnit } from '@shared/platform/games';
import { noOrphan, scoreWords, thousands } from './format';
import { listNames, ordinal } from './party';

export function resultsToShow(next: RoomState, prev: RoomState | null, meId: string | null, showing: GameResults | null, seenId: string | null, shownId: string | null = null): GameResults | null {
  const results = next.phase === 'lobby' ? next.results : null;
  if (!results) return null;
  if (showing?.id === results.id) return showing;
  if (seenId === results.id) return null;
  const tookPart = meId !== null && results.entries.some((e) => e.playerId === meId);
  const watched = prev !== null && prev.code === next.code && prev.phase === 'playing';
  return tookPart || watched || shownId === results.id ? results : null;
}

/** Best first (ties share the rank). */
export function rankedEntries(results: GameResults): ResultEntry[] {
  return results.entries.slice().sort((a, b) => a.rank - b.rank || b.score - a.score);
}

export function topEntries(results: GameResults): ResultEntry[] {
  return rankedEntries(results).filter((e) => e.rank === 1);
}

/**
 * Whether the results crown a winner: not when too few players were left to finish the game, not
 * when one player played alone (nobody to beat), and not when everyone finished on nothing.
 */
export function crowned(results: GameResults): boolean {
  return results.reason !== 'players' && results.entries.length > 1 && results.entries.some((e) => e.score > 0);
}

/**
 * "Alice wins!", "Alice and Bob tie!", or a plain line when nobody is crowned. Alone, it says how
 * they finished ("You finished with 1,250 chips"), the card's kicker already saying "Game over";
 * anyone else reading (`meId` is not the lone player: they watched) gets the player's name, never "You".
 */
export function resultsHeadline(results: GameResults, unit: ScoreUnit = 'points', meId: string | null = null): string {
  const top = topEntries(results);
  if (top.length === 0) return 'Thanks for playing!';
  const lone = loneEntry(results);
  if (lone) return soloLine(lone.score, unit, lone.playerId === meId ? null : lone.name);
  if (results.reason === 'players') return 'Game over';
  if (!crowned(results)) return 'Nobody wins this time';
  if (top.length === 1) return `${top[0].name} wins!`;
  return `${listNames(top.map((e) => e.name))} tie!`;
}

/**
 * What the results say to this player: "You won!", "You came 2nd", or null for someone who
 * watched. A game cut short crowns nobody: it says where they stood, or that nobody was ahead.
 * Alone, there is nobody to beat: it says how they finished ("You finished with 1,250 chips").
 */
export function resultsPlace(results: GameResults, meId: string | null, unit: ScoreUnit = 'points'): string | null {
  const mine = meId === null ? undefined : results.entries.find((e) => e.playerId === meId);
  if (!mine) return null;
  if (results.entries.length === 1) return soloLine(mine.score, unit);
  if (!crowned(results)) {
    const level = results.entries.every((e) => e.score === mine.score);
    if (level && mine.score === 0) return unit === 'chips' ? 'Everyone ran out of chips' : 'Nobody scored';
    if (level && results.entries.length > 1) return 'All square';
    return mine.rank === 1 ? 'You were in the lead' : `You were ${ordinal(mine.rank)}`;
  }
  if (mine.rank === 1) return topEntries(results).length > 1 ? 'You tied for the win!' : 'You won!';
  return `You came ${ordinal(mine.rank)}`;
}

/** How a lone player finished: there was nobody to beat. `name`: the player, to someone who watched them (null: the player reads it). */
function soloLine(score: number, unit: ScoreUnit, name: string | null = null): string {
  const who = name ?? 'You';
  if (score > 0) return `${who} finished with ${scoreWords(score, unit)}`;
  if (unit === 'chips') return `${who} ran out of chips`;
  return name === null ? 'No points this time' : `${name} scored no points`;
}

/** The one entry of a result that ranked a single player (they played alone, or were the last one left); null for a table and for an empty result. */
export function loneEntry(results: GameResults): ResultEntry | null {
  return results.entries.length === 1 ? results.entries[0] : null;
}

/** One row of a lone player's game: a label and its figure, ready to show. */
export interface StatRow {
  label: string;
  value: string;
}

/**
 * A lone player's game as rows: what the game counted, in its order, then their best moment
 * ("Peaked at", when the game gave one). Figures in full ("999,999,999,999"), a share as "6 of 14"
 * held together.
 */
export function statRows(entry: ResultEntry): StatRow[] {
  const rows = (entry.stats ?? []).map((s) => ({ label: s.label, value: s.of === undefined ? thousands(s.value) : `${thousands(s.value)}\u00a0of\u00a0${thousands(s.of)}` }));
  if (entry.peak !== undefined) rows.push({ label: 'Peaked at', value: thousands(entry.peak) });
  return rows;
}

/** How a player went out, for a narrow box: its last two words stay together, and a number stays with the word before it ("hand 1"). */
export function noteText(note: string): string {
  return noOrphan(note).replace(/ (?=\d)/g, '\u00a0');
}

/**
 * Why the game ended early, in a few words; null when it ran its course. `byMe`: the host who
 * ended it is the one reading (a host who played alone), so it says so rather than "the host".
 */
export function endReasonLine(results: GameResults, byMe = false): string | null {
  switch (results.reason) {
    case 'host':
      return byMe ? 'You ended the game.' : 'The host ended the game.';
    case 'players':
      return 'Too few players were left.';
    case 'finished':
      return null;
  }
}
