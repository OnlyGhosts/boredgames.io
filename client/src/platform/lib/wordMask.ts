/**
 * The type-into-the-blanks word layout shared by the games that guess a masked word (Scribble);
 * GuessTiles renders it.
 *
 * Lays a guess draft over the word mask so typed letters land in the word-length tiles.
 *
 * The mask is the server's view of the word: hidden letters are "_", revealed hint letters are
 * themselves, and spaces / hyphens / apostrophes stay where they are. Only letters and digits of
 * the draft are placed (guesses are compared without separators anyway), so a player can type
 * "ice cream" or "icecream" and both fill the same slots.
 *
 * A revealed letter is part of the word being typed: the caret may rest on it, typing that letter
 * types over it, and typing any other letter leaves it in place and lands in the slot after it.
 * The guess sent (guessText) is what the player typed with those revealed letters put back in.
 */

export type GuessSlot =
  | {
      kind: 'letter';
      /** A hint letter revealed by the server, shown faintly until typed over. */
      hint?: string;
      /** The letter the player typed into this slot. */
      typed?: string;
      /** The slot the next typed letter lands in (shows the caret while focused). */
      active: boolean;
    }
  | { kind: 'sep'; char: string };

/**
 * A guess being typed: the input's own text and, for each of its letters, the letter slot it sits
 * in (a slot past the last one is overflow). A revealed letter the player typed past takes no
 * letter of the text, so places can skip a slot; a letter keeps its slot when a hint is revealed
 * under it later, so nothing shifts while the player types.
 */
export interface GuessDraft {
  text: string;
  places: readonly number[];
}

export const EMPTY_DRAFT: GuessDraft = { text: '', places: [] };

export interface GuessLayout {
  /** One group per word of the mask. */
  groups: GuessSlot[][];
  /** Letters typed beyond the available slots, in order. */
  overflow: string[];
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]/gu;

function isLetterSlot(ch: string): boolean {
  return ch === '_' || LETTER_OR_DIGIT.test(ch);
}

/** Letters and digits of the draft as an array of characters (code points, not UTF-16 units). */
export function draftLetters(draft: string): string[] {
  return Array.from(draft.replace(NOT_LETTER_OR_DIGIT, ''));
}

/** Number of letter slots in the mask (hidden or revealed). */
export function letterCountFor(mask: string): number {
  let count = 0;
  for (const ch of mask) if (isLetterSlot(ch)) count++;
  return count;
}

/** The revealed letter of each letter slot of the mask, or null for a hidden one. */
function slotHints(mask: string): (string | null)[] {
  const hints: (string | null)[] = [];
  for (const ch of mask) if (isLetterSlot(ch)) hints.push(ch === '_' ? null : ch);
  return hints;
}

/**
 * The draft once the input's text becomes `text`. Letters the edit left alone keep their slots;
 * each new letter goes to the slot after the last one, past any revealed letter it does not match
 * (a matching one is typed over).
 */
export function typeDraft(mask: string, prev: GuessDraft, text: string): GuessDraft {
  const before = draftLetters(prev.text);
  const after = draftLetters(text);
  let kept = 0;
  while (kept < before.length && kept < after.length && kept < prev.places.length && before[kept] === after[kept]) kept++;
  const places = prev.places.slice(0, kept);
  const hints = slotHints(mask);
  let slot = kept > 0 ? places[kept - 1] + 1 : 0;
  for (const letter of after.slice(kept)) {
    while (slot < hints.length && hints[slot] !== null && !hintMatches(letter, hints[slot] as string)) slot++;
    places.push(slot++);
  }
  return { text, places };
}

/** A draft as typed from empty against this mask, or the given one when its places fit its text. */
function asDraft(mask: string, draft: GuessDraft | string): GuessDraft {
  if (typeof draft !== 'string' && draft.places.length === draftLetters(draft.text).length) return draft;
  return typeDraft(mask, EMPTY_DRAFT, typeof draft === 'string' ? draft : draft.text);
}

/** The tiles for a draft (a plain string reads as typed from empty against this mask). */
export function layoutGuess(mask: string, draft: GuessDraft | string): GuessLayout {
  const { text, places } = asDraft(mask, draft);
  const letters = draftLetters(text);
  const total = letterCountFor(mask);
  const typedAt = new Map<number, string>();
  const overflow: string[] = [];
  letters.forEach((letter, i) => {
    if (places[i] < total) typedAt.set(places[i], letter);
    else overflow.push(letter);
  });
  const next = places.length > 0 ? places[places.length - 1] + 1 : 0;
  const activeIndex = next < total ? next : -1;
  let cursor = 0;
  const groups = mask
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) =>
      Array.from(part).map((ch): GuessSlot => {
        if (!isLetterSlot(ch)) return { kind: 'sep', char: ch };
        const index = cursor++;
        const slot: GuessSlot = { kind: 'letter', active: index === activeIndex };
        if (ch !== '_') slot.hint = ch;
        const typed = typedAt.get(index);
        if (typed !== undefined) slot.typed = typed;
        return slot;
      }),
    );
  return { groups, overflow };
}

/**
 * The guess to send: what the player typed, their own spaces kept (it reads as typed in the guess
 * feed), with each revealed letter they typed past put back in its place and the revealed letters
 * the caret rests on added at the end, so it spells what the tiles show. Empty until the player
 * has typed a letter.
 */
export function guessText(mask: string, draft: GuessDraft | string): string {
  const { text, places } = asDraft(mask, draft);
  if (places.length === 0) return '';
  const hints = slotHints(mask);
  const revealed = (from: number, to: number): string => {
    let out = '';
    for (let slot = from; slot < Math.min(to, hints.length); slot++) out += hints[slot] ?? '';
    return out;
  };
  let out = '';
  let letter = 0;
  for (const ch of text) {
    if (LETTER_OR_DIGIT.test(ch)) {
      out += revealed(letter > 0 ? places[letter - 1] + 1 : 0, places[letter]);
      letter++;
    }
    out += ch;
  }
  let next = places[places.length - 1] + 1;
  while (next < hints.length && hints[next] !== null) out += hints[next++];
  return out.trim();
}

/** Whether a typed letter matches a revealed hint, ignoring case and accents. */
export function hintMatches(typed: string, hint: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return fold(typed) === fold(hint);
}

/** Letter and separator counts of one tile group; the tiles size themselves from these. */
export function groupMetrics(slots: readonly GuessSlot[]): {
  letters: number;
  seps: number;
} {
  let letters = 0;
  let seps = 0;
  for (const slot of slots) {
    if (slot.kind === 'letter') letters++;
    else seps++;
  }
  return { letters, seps };
}

/**
 * The word's shape for assistive tech, e.g. "8 letters in 2 words. Revealed: blank blank E blank".
 * On phones the tiles are the only place the mask is shown, and they are hidden from screen readers.
 */
export function describeMask(mask: string): string {
  const words = mask.split(' ').filter((part) => part.length > 0);
  const total = letterCountFor(mask);
  const shape = `${total} ${total === 1 ? 'letter' : 'letters'}${words.length > 1 ? ` in ${words.length} words` : ''}`;
  if (!Array.from(mask).some((ch) => ch !== '_' && LETTER_OR_DIGIT.test(ch))) return `${shape}.`;
  const revealed = words
    .map((word) =>
      Array.from(word)
        .filter(isLetterSlot)
        .map((ch) => (ch === '_' ? 'blank' : ch.toUpperCase()))
        .join(' '),
    )
    .join(', ');
  return `${shape}. Revealed: ${revealed}.`;
}
