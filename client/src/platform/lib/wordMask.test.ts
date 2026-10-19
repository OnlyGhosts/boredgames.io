import { describe, expect, it } from 'vitest';
import { maskWord } from '@shared/platform/words';
import { EMPTY_DRAFT, draftLetters, guessText, hintMatches, layoutGuess, letterCountFor, typeDraft, type GuessDraft, type GuessSlot } from './wordMask';

function letterSlots(groups: GuessSlot[][]): Extract<GuessSlot, { kind: 'letter' }>[] {
  return groups.flat().filter((s): s is Extract<GuessSlot, { kind: 'letter' }> => s.kind === 'letter');
}

describe('letterCountFor', () => {
  it('counts hidden and revealed letters but not separators', () => {
    expect(letterCountFor('_____')).toBe(5);
    expect(letterCountFor('i__ _____')).toBe(8);
    expect(letterCountFor("___-__ __'_")).toBe(8);
    expect(letterCountFor('')).toBe(0);
  });

  it('agrees with the server mask for real words', () => {
    expect(letterCountFor(maskWord('ice cream'))).toBe(8);
    expect(letterCountFor(maskWord("rock 'n' roll"))).toBe(9);
  });
});

describe('draftLetters', () => {
  it('keeps letters and digits only, by code point', () => {
    expect(draftLetters('ice cream')).toEqual(['i', 'c', 'e', 'c', 'r', 'e', 'a', 'm']);
    expect(draftLetters("rock-'n' roll 2")).toEqual(['r', 'o', 'c', 'k', 'n', 'r', 'o', 'l', 'l', '2']);
    expect(draftLetters('')).toEqual([]);
    expect(draftLetters('   ')).toEqual([]);
  });
});

describe('layoutGuess', () => {
  it('fills a single word in order and marks the next slot active', () => {
    const { groups, overflow } = layoutGuess('_____', 'ap');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual<GuessSlot[]>([
      { kind: 'letter', typed: 'a', active: false },
      { kind: 'letter', typed: 'p', active: false },
      { kind: 'letter', active: true },
      { kind: 'letter', active: false },
      { kind: 'letter', active: false },
    ]);
    expect(overflow).toEqual([]);
  });

  it('has the first slot active and nothing typed for an empty draft', () => {
    const { groups, overflow } = layoutGuess('___ __', '');
    const slots = letterSlots(groups);
    expect(slots).toHaveLength(5);
    expect(slots.map((s) => s.active)).toEqual([true, false, false, false, false]);
    expect(slots.every((s) => s.typed === undefined)).toBe(true);
    expect(overflow).toEqual([]);
  });

  it('skips the space between words, whether or not the player typed it', () => {
    const typedWithSpace = layoutGuess('___ _____', 'ice cream');
    const typedCompact = layoutGuess('___ _____', 'icecream');
    expect(typedWithSpace).toEqual(typedCompact);
    expect(typedWithSpace.groups).toHaveLength(2);
    expect(typedWithSpace.groups[0].map((s) => (s.kind === 'letter' ? s.typed : s.char))).toEqual(['i', 'c', 'e']);
    expect(typedWithSpace.groups[1].map((s) => (s.kind === 'letter' ? s.typed : s.char))).toEqual(['c', 'r', 'e', 'a', 'm']);
    expect(typedWithSpace.overflow).toEqual([]);
    // Everything is filled: no slot is active any more.
    expect(letterSlots(typedWithSpace.groups).some((s) => s.active)).toBe(false);
  });

  it('keeps a hyphen as a separator slot inside the group and types past it', () => {
    const { groups } = layoutGuess('___-__', 'hotd');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual<GuessSlot[]>([
      { kind: 'letter', typed: 'h', active: false },
      { kind: 'letter', typed: 'o', active: false },
      { kind: 'letter', typed: 't', active: false },
      { kind: 'sep', char: '-' },
      { kind: 'letter', typed: 'd', active: false },
      { kind: 'letter', active: true },
    ]);
  });

  it('places the next letter after a typed hyphen or apostrophe without consuming a slot', () => {
    const { groups } = layoutGuess("___'_", "don’t");
    expect(letterSlots(groups).map((s) => s.typed)).toEqual(['d', 'o', 'n', 't']);
  });

  it('carries revealed hints in their slot; typing the revealed letter types over it', () => {
    const mask = maskWord('apple', [0, 3]); // "a__l_"
    expect(mask).toBe('a__l_');
    const partial = layoutGuess(mask, 'ap');
    const slots = letterSlots(partial.groups);
    expect(slots[0]).toEqual({ kind: 'letter', hint: 'a', typed: 'a', active: false });
    expect(slots[1]).toEqual({ kind: 'letter', typed: 'p', active: false });
    expect(slots[2]).toEqual({ kind: 'letter', active: true });
    expect(slots[3]).toEqual({ kind: 'letter', hint: 'l', active: false });
    expect(slots[4]).toEqual({ kind: 'letter', active: false });
    expect(hintMatches(slots[0].typed ?? '', slots[0].hint ?? '')).toBe(true);
    expect(letterSlots(layoutGuess(mask, 'APPLE').groups).map((s) => s.typed)).toEqual(['A', 'P', 'P', 'L', 'E']);
  });

  it('matches hints ignoring case and accents', () => {
    expect(hintMatches('A', 'a')).toBe(true);
    expect(hintMatches('é', 'e')).toBe(true);
    expect(hintMatches('b', 'a')).toBe(false);
  });

  it('reports letters beyond the mask as overflow and keeps no slot active', () => {
    const { groups, overflow } = layoutGuess('___', 'is it a cat?');
    const slots = letterSlots(groups);
    expect(slots.map((s) => s.typed)).toEqual(['i', 's', 'i']);
    expect(slots.some((s) => s.active)).toBe(false);
    expect(overflow).toEqual(['t', 'a', 'c', 'a', 't']);
  });

  it('puts the active slot right after the last typed letter across groups', () => {
    const { groups } = layoutGuess('__ __', 'ab');
    expect(groups[0].every((s) => s.kind === 'letter' && !s.active)).toBe(true);
    expect(groups[1][0]).toEqual({ kind: 'letter', active: true });
    expect(groups[1][1]).toEqual({ kind: 'letter', active: false });
  });

  it('ignores stray double spaces in the mask', () => {
    const { groups } = layoutGuess('__  __', 'abcd');
    expect(groups).toHaveLength(2);
    expect(letterSlots(groups).map((s) => s.typed)).toEqual(['a', 'b', 'c', 'd']);
  });
});

import { describeMask, groupMetrics } from './wordMask';

describe('groupMetrics', () => {
  it('counts the letter tiles and separators of a group', () => {
    const { groups } = layoutGuess("___-__ __'_", '');
    expect(groupMetrics(groups[0])).toEqual({ letters: 5, seps: 1 });
    expect(groupMetrics(groups[1])).toEqual({ letters: 3, seps: 1 });
    expect(groupMetrics(layoutGuess('__________', '').groups[0])).toEqual({ letters: 10, seps: 0 });
  });
});

describe('describeMask', () => {
  it('describes the word shape when nothing is revealed', () => {
    expect(describeMask('_____')).toBe('5 letters.');
    expect(describeMask('___ _____')).toBe('8 letters in 2 words.');
    expect(describeMask('_')).toBe('1 letter.');
  });

  it('spells out revealed hint letters in place', () => {
    expect(describeMask(maskWord('apple', [0, 3]))).toBe('5 letters. Revealed: A blank blank L blank.');
    expect(describeMask('i__ __e__')).toBe('8 letters in 2 words. Revealed: I blank blank, blank blank E blank blank.');
  });
});

/** Types `keys` one at a time (Backspace as "\b"), the way the input reports each change. */
function typeKeys(mask: string, keys: string, from: GuessDraft = EMPTY_DRAFT): GuessDraft {
  let draft = from;
  for (const key of keys) draft = typeDraft(mask, draft, key === '\b' ? draft.text.slice(0, -1) : draft.text + key);
  return draft;
}

/** The tiles as one line: a letter per tile ("." blank), "^" after the caret's tile. */
function tilesOf(mask: string, draft: GuessDraft): string {
  return letterSlots(layoutGuess(mask, draft).groups)
    .map((s) => `${s.typed ?? s.hint ?? '.'}${s.active ? '^' : ''}`)
    .join('');
}

describe('typing into a word with revealed letters', () => {
  const mask = 'h_____p___'; // "helicopter" with the H and the P revealed

  it('rests the caret on a revealed letter; any other letter leaves it in place and lands after it', () => {
    let draft = typeKeys(mask, 'helico');
    expect(tilesOf(mask, draft)).toBe('helicop^...');
    draft = typeKeys(mask, 'te', draft);
    expect(tilesOf(mask, draft)).toBe('helicopte.^');
    expect(draft.text).toBe('helicote');
    expect(guessText(mask, draft)).toBe('helicopte');
    expect(guessText(mask, typeKeys(mask, 'r', draft))).toBe('helicopter');
  });

  it('types over a revealed letter when the player types it, so typing the whole word never doubles it', () => {
    const draft = typeKeys(mask, 'helicopter');
    expect(tilesOf(mask, draft)).toBe('helicopter');
    expect(layoutGuess(mask, draft).overflow).toEqual([]);
    expect(guessText(mask, draft)).toBe('helicopter');
    // Skipping the first revealed letter too.
    expect(guessText(mask, typeKeys(mask, 'elicoter'))).toBe('helicopter');
  });

  it('backspaces one tile at a time across a revealed letter', () => {
    let draft = typeKeys(mask, 'helicot');
    expect(tilesOf(mask, draft)).toBe('helicopt.^.');
    draft = typeKeys(mask, '\b', draft);
    expect(tilesOf(mask, draft)).toBe('helicop^...');
    draft = typeKeys(mask, '\b', draft);
    expect(tilesOf(mask, draft)).toBe('helic.^p...');
    expect(guessText(mask, draft)).toBe('helic');
  });

  it('keeps every typed letter in its tile when a letter is revealed under the draft', () => {
    const draft = typeKeys('__________', 'heli');
    expect(tilesOf('_x________', draft)).toBe('heli.^.....');
    expect(letterSlots(layoutGuess('_x________', draft).groups)[1]).toEqual({ kind: 'letter', hint: 'x', typed: 'e', active: false });
    // Revealed where the caret is: the caret rests on it and the next letter carries on after it.
    expect(tilesOf('____c_____', draft)).toBe('helic^.....');
    expect(tilesOf('____c_____', typeKeys('____c_____', 'o', draft))).toBe('helico.^...');
  });

  it('steps over several revealed letters in a row and across words', () => {
    expect(tilesOf('_a_a_a', typeKeys('_a_a_a', 'bnn'))).toBe('banana^');
    expect(guessText('_a_a_a', typeKeys('_a_a_a', 'bnn'))).toBe('banana');
    expect(guessText('_a_a_a', typeKeys('_a_a_a', 'banana'))).toBe('banana');
    // "ice cream" with the C of cream revealed: typed with or without the space, and with or without the C.
    for (const typed of ['ice ream', 'ice cream']) expect(guessText('___ c____', typeKeys('___ c____', typed))).toBe('ice cream');
    for (const typed of ['iceream', 'icecream']) expect(guessText('___ c____', typeKeys('___ c____', typed))).toBe('icecream');
    expect(tilesOf('___ c____', typeKeys('___ c____', 'ice'))).toBe('icec^....');
    expect(guessText('___-d__', typeKeys('___-d__', 'hot-og'))).toBe('hot-dog');
    expect(guessText('___-d__', typeKeys('___-d__', 'hotog'))).toBe('hotdog');
  });

  it('sends what was typed, revealed letters in place: nothing before a letter, letters past the end kept', () => {
    expect(guessText('h____', EMPTY_DRAFT)).toBe('');
    expect(guessText('h____', typeKeys('h____', '?! '))).toBe('');
    expect(guessText('___-___', typeKeys('___-___', 'hot '))).toBe('hot');
    // A sentence typed as a guess reads as typed in the feed.
    expect(guessText('_____ ____', typeKeys('_____ ____', 'definitely not it'))).toBe('definitely not it');
    expect(guessText('___', typeKeys('___', 'cats'))).toBe('cats');
    expect(guessText('c__', typeKeys('c__', 'ats'))).toBe('cats');
  });

  it('types a letter equal to the revealed one over it, even when the next letter is the same', () => {
    // "access" with the first C revealed: a C typed there is the revealed C, so the next C goes after it.
    expect(tilesOf('_c____', typeKeys('_c____', 'ac'))).toBe('ac.^...');
    expect(guessText('_c____', typeKeys('_c____', 'access'))).toBe('access');
  });

  it('places again only the letters after an edit in the middle of the text', () => {
    const draft = typeKeys(mask, 'helicot');
    const edited = typeDraft(mask, draft, 'helxcot');
    expect(edited.places).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect(guessText(mask, edited)).toBe('helxcopt');
    // A plain string reads as typed from empty, and stale places are worked out again.
    expect(layoutGuess(mask, 'helicot')).toEqual(layoutGuess(mask, draft));
    expect(layoutGuess(mask, { text: 'helicot', places: [] })).toEqual(layoutGuess(mask, draft));
  });
});
