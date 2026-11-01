import { useRef, type ReactNode } from 'react';
import { overflows, useFitForm } from './fit';

/** How the line reads: lime when it is on me, lilac while someone else (or the dealer) plays, red when I am out, quiet otherwise. */
export type TurnTone = 'go' | 'other' | 'bad' | 'quiet';

/** One way to say the line: its words and their quieter second part. */
export interface TurnForm {
  text: string;
  sub?: string;
}

interface Props {
  text: string;
  tone: TurnTone;
  /** The game's own state name, for data-state. */
  state: string;
  /** A quieter second part: who is next, the last move, how many bets are in, where I stand. */
  sub?: string;
  subTestId?: string;
  /** The turn clock, where the game has one (Poker). */
  clock?: ReactNode;
  /** Shorter ways to say it, for a line with no room for the whole of it, the fullest first ("Pia’s turn" and "Hand 2 of 3" for "Pia’s turn, hand 2 of 3"). */
  short?: readonly TurnForm[];
}

/** The felt the line sits on: its size is what the line's room follows, whatever the line says. */
function feltOf(el: Element): Element | null {
  return el.closest('.tbl-felt') ?? el.parentElement;
}

/**
 * The line has no room for the form on show: a part of it runs past its own width (the second
 * part keeps to one line), or it is taller than the box it sits in (a phone's Blackjack line, in
 * the room left of the dealer's hand). Measured by layout, so the line's slide-in never counts.
 */
export function turnCut(el: HTMLElement): boolean {
  const box = el.parentElement;
  if (el.scrollHeight > el.clientHeight + 0.5 || (box && el.offsetHeight > box.clientHeight + 0.5)) return true;
  return Array.from(el.children).some((part) => part instanceof HTMLElement && overflows(part));
}

/** The forms of a line, fullest first: all of it, then without its second part, then the shorter ones it brings. */
export function turnForms(text: string, sub: string | undefined, short: readonly TurnForm[] = []): TurnForm[] {
  return [{ text, sub }, ...(sub ? [{ text }] : []), ...short];
}

/**
 * The one line on a table that says what is happening, under its ribbon: whose turn it is (or how
 * the hand ended), with a quieter second part. A new line slides in. Where it has no room for the
 * whole of it, the second part goes first, then it takes its shorter forms (useFitForm): it is never
 * cut.
 */
export function TurnLine(props: Props) {
  // A new line is a new paragraph: it slides in, and its room is looked at afresh.
  return <Line key={props.text} {...props} />;
}

function Line({ text, tone, state, sub, subTestId = 'turn-sub', clock, short }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const forms = turnForms(text, sub, short);
  const at = useFitForm(ref, forms.map((f) => `${f.text}\t${f.sub ?? ''}`).join('\n'), forms.length, feltOf, turnCut);
  const shown = forms[at] ?? forms[0];
  return (
    <p ref={ref} className={`tbl-turn tbl-turn--${tone}`} data-testid="table-turn" data-state={state} data-fit={at > 0 ? at : undefined}>
      {clock && <span className="tbl-turn__clock">{clock}</span>}
      <span className="tbl-turn__text">{shown.text}</span>
      {shown.sub && (
        <span className="tbl-turn__sub" data-testid={subTestId}>
          {shown.sub}
        </span>
      )}
    </p>
  );
}
