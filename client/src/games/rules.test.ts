import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { GAMES } = await import('./index');
const { GAME_LIST, gameById } = await import('@shared/platform/games');
const { rulesSections } = await import('../platform/lib/rules');
const { RulesCard } = await import('../platform/components/HowToPlay');
const { CHOOSE_TIME_SECONDS } = await import('@shared/games/scribble/constants');
const { SCRIBBLE_DRAW_SECONDS } = await import('@shared/games/scribble/protocol');
const { SPYGAME_CANDIDATES, SPYGAME_GUESSES, SPYGAME_ROUND_MINUTES, SPYGAME_POINTS, SPYGAME_VOTE_SECONDS } = await import('@shared/games/spygame/protocol');
const { QUIPGAME_POINTS, QUIPGAME_VOTE_SECONDS, QUIPGAME_WRITE_SECONDS } = await import('@shared/games/quipgame/protocol');
const { BLACKJACK, DEALER_STANDS_AT, NATURAL_PAYOUT, naturalWinnings } = await import('@shared/games/blackjack/cards');
const { POKER_ACT_SECONDS } = await import('@shared/games/poker/protocol');

/** The rules the card reads: the summary and the five sections, in reading order. */
function copyOf(gameId: keyof typeof GAMES): string[] {
  const rules = GAMES[gameId].rules;
  return [rules.summary, ...rulesSections(rules).map((s) => s.text)];
}

/** The facts as "label: value (note)" lines, for pinning a number to its tile. */
function factsOf(gameId: keyof typeof GAMES): string[] {
  return GAMES[gameId].rules.facts.map((f) => `${f.label}: ${f.value} (${f.note})`);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const live = GAME_LIST.filter((g) => g.status === 'live');
const HERO_KINDS = ['cards', 'canvas', 'place', 'quips', 'glyph'];

describe('every game’s How to play', () => {
  it('has a summary and the five sections, each with something to say, in the order the card shows them', () => {
    for (const g of GAME_LIST) {
      const rules = GAMES[g.id].rules;
      expect(rules.summary.trim().length, g.id).toBeGreaterThan(0);
      const sections = rulesSections(rules);
      expect(sections.map((s) => s.key)).toEqual(['round', 'scoring', 'end', 'settings', 'watchers']);
      for (const s of sections) expect(s.text.trim().length, `${g.id} ${s.key}`).toBeGreaterThan(0);
      expect(sections.map((s) => s.heading)).toEqual([rules.unit === 'hand' ? 'How a hand goes' : 'How a round goes', 'How you score', 'How it ends', 'What the settings change', 'Watching']);
      // Everyone who joins mid-game watches: every game says so.
      expect(rules.watchers).toContain('Join mid-game and you watch until the next game.');
    }
    // The card tables deal hands; the others play rounds.
    expect(GAMES.blackjack.rules.unit).toBe('hand');
    expect(GAMES.poker.rules.unit).toBe('hand');
    expect(GAMES.scribble.rules.unit).toBeUndefined();
  });

  it('keeps each live game under about 140 words, in short plain copy: no dashes, curly apostrophes, British spelling', () => {
    for (const g of live) {
      const copy = copyOf(g.id);
      expect(copy.reduce((n, text) => n + words(text), 0), `${g.id} word count`).toBeLessThanOrEqual(140);
      for (const text of copy) {
        expect(text, g.id).not.toMatch(/[—–]/);
        expect(text, g.id).not.toContain("'");
        expect(text, g.id).not.toMatch(/\s{2,}/);
        expect(text.trim(), g.id).toMatch(/[.!?)]$/);
        expect(text, g.id).not.toMatch(/favorite|color|center|customiz/i);
      }
    }
  });

  it('has an illustration the platform can draw and exactly four key facts, each short enough for its tile, in the same plain style', () => {
    for (const g of GAME_LIST) {
      const { hero, facts } = GAMES[g.id].rules;
      expect(HERO_KINDS, `${g.id} hero`).toContain(hero.kind);
      if ('badge' in hero) expect(hero.badge.trim().length, `${g.id} badge`).toBeGreaterThan(0);
      expect(facts, g.id).toHaveLength(4);
      for (const f of facts) {
        for (const text of [f.label, f.value, f.note]) {
          expect(text.trim().length, `${g.id} ${f.label}`).toBeGreaterThan(0);
          expect(text, g.id).not.toMatch(/[—–]/);
          expect(text, g.id).not.toContain("'");
          expect(text, g.id).not.toMatch(/\s{2,}/);
        }
        // The value keeps to one line on a 320px phone ("Stands on 17" is about the limit); the label and note stay short.
        expect(f.value.length, `${g.id} ${f.label}: ${f.value}`).toBeLessThanOrEqual(12);
        expect(f.label.length, `${g.id} ${f.label}`).toBeLessThanOrEqual(16);
        expect(words(f.note), `${g.id} ${f.label}: ${f.note}`).toBeLessThanOrEqual(8);
        expect(f.note, g.id).not.toMatch(/\.$/);
      }
    }
    // The card tables show their cards, Scribble its canvas, the others their own scenes; the template starts on the glyph.
    expect(GAMES.blackjack.rules.hero).toEqual({ kind: 'cards', cards: ['AS', 'KH'], badge: `${BLACKJACK}` });
    expect(GAMES.poker.rules.hero.kind).toBe('cards');
    expect(GAMES.scribble.rules.hero).toEqual({ kind: 'canvas', badge: `${SCRIBBLE_DRAW_SECONDS} s` });
    expect(GAMES.spygame.rules.hero).toEqual({ kind: 'place', badge: `${SPYGAME_ROUND_MINUTES} min` });
    expect(GAMES.quipgame.rules.hero).toEqual({ kind: 'quips', badge: `${QUIPGAME_WRITE_SECONDS} s` });
    expect(GAMES.template.rules.hero).toEqual({ kind: 'glyph' });
  });

  it('takes every number from the game’s shared constants, so the copy cannot drift from the server', () => {
    // Scribble's clocks and points sit in its facts; the prose keeps the flow of a turn.
    expect(factsOf('scribble')).toEqual([`Pick a word: ${CHOOSE_TIME_SECONDS} s (Else the first)`, `Draw it: ${SCRIBBLE_DRAW_SECONDS} s (Others type guesses)`, 'Right guess: 400 (Sliding to 50 at the last second)', 'Drawer: 300 (Up to, scaled by guessers who got it)']);
    expect(GAMES.scribble.rules.round).not.toMatch(/\d/);
    expect(GAMES.scribble.rules.scoring).toBe('A right guess pays more the sooner it comes; the drawer earns more the more guessers get it.');
    // The hints setting is capped at half the word's letters (shared/games/scribble/hints.ts).
    expect(GAMES.scribble.rules.settings).toContain('at most half the letters');
    expect(factsOf('spygame')[0]).toBe(`Round clock: ${SPYGAME_ROUND_MINUTES} min (Quiz each other without giving it away)`);
    expect(factsOf('spygame')[1]).toBe(`Spy sees: ${SPYGAME_CANDIDATES} places (The agents see the real one)`);
    expect(factsOf('spygame')[2]).toBe(`Spy guesses: ${SPYGAME_GUESSES} (Wrong twice and the agents win)`);
    expect(GAMES.spygame.rules.scoring).toContain(`${SPYGAME_POINTS.spyFirstGuess} points (${SPYGAME_POINTS.spySecondGuess} on the second guess)`);
    // The vote: the clock pauses, the accused and the spy do not vote, a missing vote is a No, a tie fails (server/games/spygame/vote.ts).
    expect(factsOf('spygame')[3]).toBe(`Vote: ${SPYGAME_VOTE_SECONDS} s (No vote counts as No)`);
    expect(GAMES.spygame.rules.round).toContain('the clock pauses while the other agents vote, and a tie fails');
    expect(factsOf('quipgame')[0]).toBe(`Write: ${QUIPGAME_WRITE_SECONDS} s (Two prompts a round, one in the final)`);
    expect(factsOf('quipgame')[1]).toBe(`Vote: ${QUIPGAME_VOTE_SECONDS} s (The writers stay hidden)`);
    expect(factsOf('quipgame')[2]).toBe('A matchup: 1,000 (Split by votes; double in round two)');
    // The flawless bonus needs 2 or more votes and doubles with the round (shared/games/quipgame/scoring.ts).
    expect(factsOf('quipgame')[3]).toBe(`Flawless: +${QUIPGAME_POINTS.flawless} (Take every vote, ${QUIPGAME_POINTS.flawlessMinVotes} or more)`);
    expect(GAMES.quipgame.rules.scoring).toContain('Round two pays double, the flawless bonus included.');
    expect(GAMES.quipgame.rules.scoring).toContain('1,500, 1,000 and 500');
    // Blackjack: the goal, the bust, the dealer's play and the natural's payout are the four facts.
    expect(factsOf('blackjack')).toEqual([`Goal: ${BLACKJACK} (Beat the dealer,\ndon’t go over)`, `Bust: Over ${BLACKJACK} (Loses even if the dealer busts)`, `Dealer: Stands on ${DEALER_STANDS_AT} (Draws to ${DEALER_STANDS_AT - 1})`, `Blackjack pays: ${NATURAL_PAYOUT.wins} to ${NATURAL_PAYOUT.stake} (Rounded down)`]);
    expect(factsOf('blackjack').join(' ')).toContain('Stands on 17');
    expect(factsOf('blackjack').join(' ')).toContain('3 to 2');
    expect(naturalWinnings(2)).toBe(3);
    expect(naturalWinnings(1)).toBe(1);
    // The dealer peeks with an ace or a ten up; double is offered on two cards only; alone, the game ends when the one stack is gone.
    expect(GAMES.blackjack.rules.round).toContain('Ace or ten up, the dealer checks for blackjack, which ends the hand.');
    expect(GAMES.blackjack.rules.round).toContain('double your first two cards for one more');
    expect(GAMES.blackjack.rules.round).not.toContain('busts');
    expect(GAMES.blackjack.rules.scoring).toBe('Beat the dealer to win your bet. A tie returns your bet. A bust loses even if the dealer busts.');
    expect(GAMES.blackjack.rules.end).toContain('one stack left, or none, or at the host’s word, after the hand');
    // The host's End game ends the point games at once on the scores as they stand.
    for (const id of ['scribble', 'spygame', 'quipgame'] as const) expect(GAMES[id].rules.end, id).toContain('or when the host ends it');
    expect(GAMES.blackjack.rules.settings).toContain('100 to 100,000');
    expect(factsOf('poker')[2]).toBe(`To act: ${POKER_ACT_SECONDS} s (Else you check or fold)`);
    expect(GAMES.poker.rules.round).not.toMatch(/\d/);
    expect(GAMES.poker.rules.watchers).toContain(`seats ${gameById('poker').maxPlayers}`);
  });

  it('renders each paragraph with its last two words joined, so no word sits alone on the card’s last line', () => {
    for (const g of GAME_LIST) {
      const html = renderToString(createElement(RulesCard, { meta: g, rules: GAMES[g.id].rules, mode: 'popover' }));
      const paragraphs = [...html.matchAll(/<p class="rules__(?:summary|text)">([^<]*)<\/p>/g)].map((m) => m[1]);
      expect(paragraphs, g.id).toHaveLength(6);
      for (const p of paragraphs) {
        expect(p, `${g.id}: ${p}`).toMatch(/\S \S+$/);
        expect(p.split(' '), g.id).toHaveLength(2);
      }
      expect(html).toContain(`data-game="${g.id}"`);
      expect(html.match(/data-testid="rules-section"/g)).toHaveLength(5);
      // The hero draws, and the four facts show, with a note's last two words joined too.
      const { hero, facts } = GAMES[g.id].rules;
      expect(html).toContain(`data-testid="rules-hero" data-kind="${hero.kind}"`);
      if ('badge' in hero) expect(html).toContain(`class="rules-hero__badge">${hero.badge}<`);
      const drawn = { cards: 'data-testid="rules-hero-card"', canvas: 'class="rules-hero__canvas"', place: 'class="rules-hero__spy"', quips: 'class="rules-hero__quips"', glyph: `data-glyph="${g.id}"` }[hero.kind];
      expect(html, `${g.id} hero`).toContain(drawn);
      expect(html.match(/data-testid="rules-fact"/g)).toHaveLength(4);
      for (const f of facts) {
        expect(html).toContain(`<span class="rules-fact__value">${f.value}</span>`);
        expect(html).toContain(`<span class="rules-fact__note">${f.note.replace(/ (\S+)$/, '\u00a0$1')}</span>`);
      }
    }
  });
});
