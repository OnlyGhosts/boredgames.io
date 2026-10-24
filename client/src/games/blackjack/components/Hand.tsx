import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { HandFan, OutcomeFlag } from '../../../platform/table/HandFan';
import { PayoutFloat, type Tone } from '../../../platform/table/Outcome';
import { STAGE_FIT } from '../../../platform/table/fit';
import { StakePill } from '../../../platform/table/Stakes';
import { TableCard } from '../../../platform/table/TableCard';
import { cardKey, shownTotal, totalText, type TableHand } from '../lib/table';
import { cardMotion, cardShown, landed, outcomesShown, type Timeline } from '../lib/timeline';
import { outcomeLabel, payoutText } from '../lib/text';

export type HandTone = Tone;

interface Props {
  playerId: string;
  index: number;
  hand: TableHand;
  /** The table's starting stack: the chips a stake is drawn in. */
  start: number;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  size: PlayingCardSize;
  /** The hand in play right now. */
  active: boolean;
  /** A seat's small hand: the pill beside the cards, the outcome only as colour. */
  mini?: boolean;
  /** One of several hands side by side: the outcome's word goes inside the pill, which stays over its own hand. */
  narrow?: boolean;
  /** One of my split hands in their grid: its stake (while it plays) or how it ended goes under its cards, so the corner holds its total alone. */
  footed?: boolean;
  /** On the stage while it plays: its stake by its total (its chips and the figure, read as "Bet 10"). */
  stake?: boolean;
  /** Another player's hand on my stage: their name by its total. */
  ownerName?: string;
  testId: string;
}

/**
 * The hand as the timeline shows it at `now`: the cards on the felt so far (one may still be
 * sliding in), the total of those that have landed and, once settled on screen, the outcome.
 */
export function handOnScreen(playerId: string, index: number, hand: TableHand, timeline: Timeline, now: number) {
  const cards = hand.cards.map((card, i) => ({ card, key: cardKey(playerId, index, i, card) })).filter((c) => cardShown(timeline, c.key, now));
  const total = shownTotal(cards.filter((c) => landed(timeline, c.key, now)).map((c) => c.card));
  const outcome = hand.outcome !== null && outcomesShown(timeline, now) ? hand.outcome : null;
  return { cards, total, outcome };
}

/** A hand's colour: its outcome once shown, a bust or a natural as soon as they land, lit while in play. */
export function handTone(outcome: TableHand['outcome'], bust: boolean, natural: boolean, active: boolean): HandTone {
  if (outcome === 'loss' && bust) return 'bust';
  if (outcome) return outcome;
  if (bust) return 'bust';
  if (natural) return 'blackjack';
  return active ? 'active' : 'neutral';
}

/** The word for how a hand ended: a busted loss says Bust. */
function endWord(outcome: NonNullable<TableHand['outcome']>, bust: boolean): string {
  return outcome === 'loss' && bust ? 'Bust' : outcomeLabel(outcome);
}

/**
 * The stake ("Bet 10": its chips and the figure) by a hand's total, at a table that started with
 * `start` chips: in full ("12,000") on a hand of its own, as the seats' pills read beside it. The
 * short form ("12k") is only for where the pill would crowd its line: split hands side by side on a
 * phone's stage (blackjack.css), and a figure that would run the pill off the stage (my next stake
 * beside my empty places, "1,250,000" on a 375px phone: STAGE_FIT, measured).
 */
export function stakeOf(value: number, start: number, testId?: string) {
  return <StakePill value={value} start={start} format="fit" fit={STAGE_FIT} className="tbl-hand__stake" testId={testId} />;
}

/** Left of a hand's total while it plays: its owner's name on my stage, its stake, or the doubled tag. */
function leadOf(hand: TableHand, start: number, stake: boolean, ownerName: string | undefined) {
  if (ownerName) {
    return (
      <span className="tbl-hand__owner" data-testid="stage-owner">
        {ownerName}
      </span>
    );
  }
  if (stake) return stakeOf(hand.bet, start, 'hand-bet');
  return hand.doubled ? <span className="tbl-tag">2x</span> : null;
}

/**
 * One hand as a stepped fan with its total over the top right corner; once settled, every card is
 * outlined in the outcome's colour, the pill takes it too, and the outcome is said in words beside
 * the pill ("Win +20"). While it plays its stake is there on the stage (a doubled one reads double),
 * or the owner's name when it is another player's hand on my stage; on a seat a doubled hand is tagged "2x".
 */
export function Hand({ playerId, index, hand, start, timeline, now, leaving, size, active, mini = false, narrow = false, footed = false, stake = false, ownerName, testId }: Props) {
  const { cards, total, outcome } = handOnScreen(playerId, index, hand, timeline, now);
  const bust = total !== null && total.total > 21;
  const tone = handTone(outcome, bust, hand.status === 'blackjack' && cards.length === 2, active);
  const payout = outcome && outcome !== 'push' && hand.payout !== null ? payoutText(hand.payout) : '';
  const word = outcome ? endWord(outcome, bust) : '';
  // Beside the pill on a hand of its own; inside it, before the total, when hands sit side by side.
  const inPill = narrow && outcome !== null && !mini && !footed;
  // My split hands: the stake (one chip, short: "50k") and then how the hand ended go under the cards, so the words over the corner are the total alone.
  const flag = mini || inPill || footed ? null : outcome ? <OutcomeFlag tone={tone} word={word} extra={payout} testId="hand-outcome" /> : leadOf(hand, start, stake, ownerName);
  let foot;
  if (footed && outcome) {
    foot = (
      <span className={`tbl-flag tbl-flag--${tone} bj-hand__foot`} data-testid="hand-outcome">
        {word}
      </span>
    );
  } else if (footed && stake) foot = <StakePill value={hand.bet} start={start} format="short" chips={1} className="tbl-hand__stake bj-hand__foot" testId="hand-bet" />;
  const lead = inPill ? <span className="tbl-pill__lead" data-testid="hand-outcome">{word}</span> : undefined;
  return (
    <HandFan
      className={`bj-hand${footed ? ' bj-hand--footed' : ''}`}
      size={mini ? 'mini' : 'big'}
      tone={tone}
      total={total ? totalText(total, hand.outcome === null && (hand.status === 'waiting' || hand.status === 'acting')) : null}
      lead={lead}
      totalTestId="hand-total"
      flag={flag}
      foot={foot}
      float={outcome && payout && !mini && !footed ? <PayoutFloat text={payout} tone={tone} /> : undefined}
      label={`Hand ${index + 1}${total ? `: ${total.total}` : ''}${outcome ? `, ${endWord(outcome, bust)}` : ''}`}
      testId={testId}
      data={{
        'data-index': index,
        'data-status': hand.status,
        'data-total': total?.total ?? 0,
        'data-bet': hand.bet,
        'data-cards': cards.length,
        'data-active': active,
        'data-outcome': outcome ?? undefined,
        'data-payout': outcome ? (hand.payout ?? 0) : undefined,
      }}
    >
      {cards.map(({ card, key }) => (
        <TableCard key={`${timeline.id}:${key}`} card={card} size={size} motion={cardMotion(timeline, key, now)} leaving={leaving} testId="card" />
      ))}
    </HandFan>
  );
}
