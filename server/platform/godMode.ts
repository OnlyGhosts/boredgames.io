import { AVATAR_COLORS, AVATAR_FACES, type Avatar } from '../../shared/platform/avatar.js';

const GOD_NAME = 'jord';
const GOD_FACE = AVATAR_FACES.findIndex((f) => f.emoji === '👻');
const GOD_COLOR = AVATAR_COLORS.indexOf('#ec4899');

/** The owner's hidden god mode, server side only: named jord with the pink ghost avatar (never the spy, never busts at Blackjack). */
export function isGodMode(player: { name: string; avatar?: Avatar } | undefined): boolean {
  const avatar = player?.avatar;
  return avatar !== undefined && player?.name.trim().toLowerCase() === GOD_NAME && avatar.emoji === GOD_FACE && avatar.color === GOD_COLOR;
}
