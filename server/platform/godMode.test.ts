/** God mode: who gets it (the name jord with the pink ghost, all three at once), and that it follows the look worn now. */
import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, AVATAR_FACES, type Avatar } from '../../shared/platform/avatar.js';
import { platformPlayers } from './engine/players.js';
import { AVATAR, GOD_AVATAR, readyUp, sim, startGame } from './engine/testHarness.js';
import { isGodMode } from './godMode.js';

describe('God mode', () => {
  it('is the pink ghost on a player named jord, trimmed and in any case', () => {
    expect(AVATAR_FACES[GOD_AVATAR.emoji].emoji).toBe('👻');
    expect(AVATAR_COLORS[GOD_AVATAR.color]).toBe('#ec4899');
    for (const name of ['jord', 'Jord', 'JORD', 'jOrD', '  jord  ', '\tJord\n']) expect(isGodMode({ name, avatar: GOD_AVATAR })).toBe(true);
  });

  it('gives nothing to a near miss: the wrong name, the wrong face, the wrong colour, or no look at all', () => {
    for (const name of ['jordan', 'jor', 'j ord', 'jord!', 'Jord 2', 'george', '']) expect(isGodMode({ name, avatar: GOD_AVATAR })).toBe(false);
    AVATAR_FACES.forEach((_, emoji) => {
      if (emoji !== GOD_AVATAR.emoji) expect(isGodMode({ name: 'jord', avatar: { ...GOD_AVATAR, emoji } })).toBe(false);
    });
    AVATAR_COLORS.forEach((_, color) => {
      if (color !== GOD_AVATAR.color) expect(isGodMode({ name: 'jord', avatar: { ...GOD_AVATAR, color } })).toBe(false);
    });
    expect(isGodMode({ name: 'jord', avatar: AVATAR })).toBe(false);
    expect(isGodMode({ name: 'jord' })).toBe(false);
    expect(isGodMode(undefined)).toBe(false);
  });

  it('follows the look the player wears now: changed into in the lobby, and dropped there again', () => {
    const s = sim('spygame');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const godMode = (id: string): boolean => isGodMode(platformPlayers(s.data).find((p) => p.id === id));
    expect([alice, bob, carol].map(godMode)).toEqual([false, false, false]);
    // Back in the lobby, Carol changes her look, then the next game starts.
    const lookThenPlay = (look: { name?: string; avatar?: Avatar }): void => {
      s.platform(alice, { t: 'endGame' });
      s.platform(carol, { t: 'updateProfile', ...look });
      readyUp(s, [bob, carol]);
      s.platform(alice, { t: 'start' });
    };
    lookThenPlay({ name: 'Jord', avatar: GOD_AVATAR });
    expect([alice, bob, carol].map(godMode)).toEqual([false, false, true]);
    lookThenPlay({ avatar: { ...GOD_AVATAR, color: GOD_AVATAR.color - 1 } });
    expect(godMode(carol)).toBe(false);
  });
});
