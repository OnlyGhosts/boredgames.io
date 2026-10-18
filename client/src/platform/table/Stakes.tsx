import { betChips, chipFigure, stakeText, type ChipBand, type StakeFormat } from './stakes';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

/**
 * The figure in a stack or a stake. `fit` writes both forms and table.css picks one by the tile's
 * width and, for a stake, by its pill (two chips or a plus are wider than the word Bet was): a
 * stack reads "1,040" wherever it fits, and a stake read as "1k" is told from 1,000 by its chips
 * (PlayersGrid's tileFigures says where each reads short).
 */
function Figure({ value, format, className }: { value: number; format: StakeFormat; className: string }) {
  const full = chipFigure(value, 'full');
  const short = chipFigure(value, 'short');
  if (format !== 'fit' || full === short) return <span className={className}>{chipFigure(value, format)}</span>;
  return (
    <span className={`${className} tbl-figure`}>
      <span className="tbl-figure__full">{full}</span>
      <span className="tbl-figure__short">{short}</span>
    </span>
  );
}

interface StackProps {
  value: number;
  format?: StakeFormat;
  className?: string;
  testId?: string;
}

/** A stack of five digits or more ("12,500"): a narrow tile reads it short (table.css). */
const LONG_FIGURE = 6;

/** A stake of four digits or more ("1,000"): a tile reads it short ("1k") where the pill would crowd its line (table.css, PlayersGrid's tileFigures). */
const LONG_STAKE = 5;

/** A player's stack, in words: the figure large and bold, "chips" after it ("1,000 chips"); `data-long` marks a five-digit one. */
export function StackCount({ value, format = 'full', className, testId }: StackProps) {
  return (
    <span className={`tbl-stackcount${className ? ` ${className}` : ''}`} data-testid={testId} data-chips={value} data-long={chipFigure(value, 'full').length >= LONG_FIGURE ? '' : undefined}>
      <Figure value={value} format={format} className="tbl-stackcount__value" /> <span className="tbl-stackcount__word">{value === 1 ? 'chip' : 'chips'}</span>
    </span>
  );
}

/** One face-on chip, the Poker tile's family: a hard ink shadow, the disc, six edge spots, a centre ring (table.css sizes and colours it). */
function ChipFace({ band }: { band: ChipBand }) {
  return (
    <svg className="tbl-stake__chip" viewBox="0 0 25.5 25.5">
      <g className={`tbl-chip tbl-chip--${band}`} data-band={band}>
        <circle className="tbl-chip__shadow" cx="13.2" cy="13.4" r="10.6" />
        <circle className="tbl-chip__disc" cx="12" cy="12" r="10.6" />
        <circle className="tbl-chip__spots" cx="12" cy="12" r="8.4" />
        <circle className="tbl-chip__ring" cx="12" cy="12" r="4.6" />
      </g>
    </svg>
  );
}

/**
 * A few chips spread sideways, each overlapping two thirds of the one before, the last on top (a
 * chip each, so a narrow tile can keep the first alone: table.css); the pill's label says the sum.
 */
function ChipSpread({ bands }: { bands: readonly ChipBand[] }) {
  return (
    <span className="tbl-stake__chips" aria-hidden="true" data-count={bands.length}>
      {bands.map((band, i) => (
        <ChipFace key={i} band={band} />
      ))}
    </span>
  );
}

interface PillProps {
  value: number;
  format?: StakeFormat;
  className?: string;
  testId?: string;
  data?: DataAttrs;
}

interface BetPillProps extends PillProps {
  /** A stake in front of a player: chips in place of a word. */
  kind?: 'bet';
  /** The table's starting stack: the chips' denominations go by it, never by the bet (stakes.ts). */
  start: number;
  /** The most chips drawn: three, or two on a compact tile (PlayersGrid's tileChips). */
  chips?: number;
}

interface PotPillProps extends PillProps {
  /** The middle of the table: the word before the figure. */
  kind: 'pot';
  /** The word ("Pot"). */
  word?: string;
}

type StakeProps = BetPillProps | PotPillProps;

/**
 * A stake as its own gold pill, never a bare number beside the stack. A bet draws the chips it
 * breaks into (betChips: biggest first, a plus when more are owed than drawn) with the figure
 * beside them, and reads as "Bet 10"; the pot keeps its word ("Pot 120").
 */
export function StakePill(props: StakeProps) {
  const { value, format = 'full', className, testId, data } = props;
  const extra = className ? ` ${className}` : '';
  if (props.kind === 'pot') {
    return (
      <span className={`tbl-stake tbl-stake--pot${extra}`} data-testid={testId} data-bet={value} {...data}>
        <span className="tbl-stake__word">{props.word ?? 'Pot'}</span> <Figure value={value} format={format} className="tbl-stake__value" />
      </span>
    );
  }
  const { bands, count, more } = betChips(value, props.start, props.chips ?? 3);
  // Wider than the word Bet was (two chips, or a plus): a compact tile, and a full one 200px to 239px wide, read a four-digit figure beside them short (table.css).
  const wide = bands.length > 1 || more;
  return (
    <span className={`tbl-stake tbl-stake--bet${wide ? ' tbl-stake--wide' : ''}${extra}`} role="img" aria-label={stakeText(value)} data-testid={testId} data-bet={value} data-chips={count} data-bands={bands.join(' ')} data-long={chipFigure(value, 'full').length >= LONG_STAKE ? '' : undefined} {...data}>
      <ChipSpread bands={bands} />
      {/* The plus: shown when more chips are owed than drawn; a spare one, hidden until a tile or the phone's stage hides a drawn chip (table.css, blackjack.css). */}
      {count > 1 && (
        <span className={`tbl-stake__more${more ? '' : ' tbl-stake__more--spare'}`} aria-hidden="true">
          +
        </span>
      )}
      <Figure value={value} format={format} className="tbl-stake__value" />
    </span>
  );
}
