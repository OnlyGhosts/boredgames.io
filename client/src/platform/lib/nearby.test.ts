import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NearbyRooms } from '../components/NearbyRooms';
import { nearbyMeta, parseNearby, roomTitle, type NearbyCard } from './nearby';

const card = (over: Partial<NearbyCard> = {}): NearbyCard => ({ code: 'AB2K', gameId: 'scribble', host: { name: 'Jord', avatar: { color: 0, emoji: 1 } }, players: 3, ageMs: 2 * 60_000, playing: false, ...over });

describe('the nearby list', () => {
  it('reads the server answer, ages rooms by the server clock and leaves out anything malformed', () => {
    const good = { code: 'AB2K', gameId: 'scribble', host: { name: 'Jord', avatar: { color: 0, emoji: 1 } }, players: 3, createdAt: 1000, playing: false };
    const cards = parseNearby({ now: 1000 + 125_000, rooms: [good, { ...good, code: '??' }, { ...good, host: { name: 'X' } }, { ...good, gameId: 'nope' }] });
    expect(cards).toEqual([card({ ageMs: 125_000 })]);
    expect(parseNearby({ now: 2000, rooms: [{ ...good, playing: true }] })[0]?.playing).toBe(true);
    expect(parseNearby(null)).toEqual([]);
    expect(parseNearby({ rooms: [good] })).toEqual([]);
    expect(parseNearby({ now: 2000, rooms: [good, good, good, good] })).toHaveLength(3);
  });
  it('writes the meta line short: game, players, and playing now in a game; it wraps only between parts, never leaving a dot at a line end', () => {
    expect(nearbyMeta(card())).toEqual(['Scribble', '3 players']);
    expect(nearbyMeta(card({ players: 1 }))).toEqual(['Scribble', '1 player']);
    expect(nearbyMeta(card({ players: 4, playing: true }))).toEqual(['Scribble', '4 players', 'playing now']);
    expect(roomTitle('Jord')).toBe('Jord’s room');
    // Each part after the first carries its dot in front, inside the part that cannot break: a part that
    // wraps to a new line takes its dot with it (into the clipped margin), never leaving it at the end of the line before.
    const html = renderToString(createElement(NearbyRooms, { rooms: [card({ players: 4, playing: true })], onJoin: () => undefined })).replace(/<!-- -->/g, '');
    const parts = [...html.matchAll(/<span class="dot-list__part">(.*?)<\/span>(?=<span class="dot-list__part">|<\/span>)/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    expect(parts).toEqual(['Scribble', ' · 4 players', ' · playing now']);
    expect(html.replace(/<[^>]+>/g, '')).toContain('Scribble · 4 players · playing now');
  });

  it('renders one card per room with a Join button, and nothing at all for none', () => {
    expect(renderToString(createElement(NearbyRooms, { rooms: [], onJoin: () => undefined }))).toBe('');
    const html = renderToString(createElement(NearbyRooms, { rooms: [card(), card({ code: 'CD3M', host: { name: 'Sam', avatar: { color: 1, emoji: 2 } } })], onJoin: () => undefined }));
    expect(html).toContain('aria-label="On your Wi-Fi"');
    expect(html).not.toContain('<h2');
    expect(html.match(/data-testid="nearby-room"/g)).toHaveLength(2);
    expect(html).toContain('Jord’s room');
    expect(html.replace(/<[^>]+>/g, '')).toContain('Scribble · 3 players');
    expect(html).toContain('aria-label="Join Sam’s room"');
  });
});
