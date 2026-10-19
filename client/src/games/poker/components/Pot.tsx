import type { PokerPotView } from '@shared/games/poker/protocol';
import { meets, overflows, type FitRule } from '../../../platform/table/fit';
import { StakePill } from '../../../platform/table/Stakes';
import { formatChips } from '../lib/text';
import { POT_ANCHOR } from '../lib/timeline';

interface Props {
  /** The chips in the middle on show. */
  shown: number;
  /** The chips in the middle in truth. */
  truth: number;
  /** The pots so far: side pots are listed small beside the pill. */
  pots: PokerPotView[];
}

/**
 * The pot crowds the board: on the shortest phones, where it sits beside the board rather than
 * over it, the pill runs into the board's cards, or squeezes them.
 */
function crowdsBoard(el: HTMLElement): boolean {
  const board = el.closest('.pk-centre')?.querySelector<HTMLElement>('.pk-board');
  if (!board) return false;
  return overflows(board) || meets(el.getBoundingClientRect(), board.getBoundingClientRect());
}

/** The pot's figure in full ("Pot 14,500") wherever it fits, short ("Pot 1.3M") only where it would crowd the board. */
const POT_FIT: FitRule = { box: (el) => el.closest('.pk-centre'), cut: crowdsBoard };

/** The pot over the board as its own pill ("Pot 14,500"), with any side pots listed small beside it. */
export function Pot({ shown, truth, pots }: Props) {
  const sides = pots.length > 1 ? pots : [];
  return (
    <div className="pk-pot">
      <StakePill value={shown} word="Pot" kind="pot" format="fit" fit={POT_FIT} className={`pk-pot__pill${shown > 0 ? '' : ' is-empty'}`} testId="pot" data={{ 'data-chips': truth, 'data-shown': shown, 'data-table-anchor': POT_ANCHOR }} />
      {sides.length > 0 && (
        <ul className="pk-pot__sides" aria-label="Pots" data-testid="pots">
          {sides.map((pot, i) => (
            <li key={i} className="pk-pot__side" data-testid="side-pot" data-amount={pot.amount} data-players={pot.playerIds.join(',')}>
              {i === 0 ? 'Main' : `Side ${i}`} {formatChips(pot.amount)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
