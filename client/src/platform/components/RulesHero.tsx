import { cardOf } from '@shared/platform/cards';
import type { GameMeta } from '@shared/platform/games';
import type { RulesHero } from '../game';
import { GameGlyph } from './GameGlyph';
import { PlayingCard } from './PlayingCard';

/** The doodle on Scribble's mini canvas: a sun, a hill with a house on it, the ground. Strokes in an 84x62 box. */
const DOODLE = [
  'M14 16a7 7 0 1 0 .1 0',
  'M14 3v3M14 26v3M1 16h3M24 16h3M5 7l2 2M21 7l-2 2M5 25l2-2M21 25l-2-2',
  'M30 50q12-14 28-10t22 10',
  'M44 44V32l10-8 10 8v12',
  'M50 44v-7h8v7',
  'M2 60q20-6 40-4t40 2',
];

/** The place card's skyline: a sun over three buildings with their windows, in a 56x62 box. */
const SKYLINE = ['M40 14a5 5 0 1 0 .1 0', 'M40 4v3M40 21v3M30 14h3M47 14h3', 'M5 50V34h10v-8h8v24', 'M27 50V24l7-6 7 6v26', 'M45 50V38h7v12', 'M2 50h52', 'M11 40h2M11 45h2M18 32h2M18 38h2M18 44h2M32 33h4v5h-4zM47 43h3'];

interface Props {
  hero: RulesHero;
  meta: GameMeta;
}

/**
 * The illustration at the top of the How to play card, drawn by the platform from the game's
 * `hero` data (platform/game.ts) in its accent: the site's own playing cards, a mini canvas, a
 * place card and the spy's, two speech bubbles, or the glyph on its plate. Decorative (the facts
 * say the numbers), inline SVG and CSS only, so it renders on the server too.
 */
export function RulesHeroArt({ hero, meta }: Props) {
  return (
    <div className={`rules-hero__art rules-hero__art--${hero.kind}`} data-testid="rules-hero" data-kind={hero.kind} aria-hidden="true">
      {art(hero, meta)}
      {'badge' in hero && <span className="rules-hero__badge">{hero.badge}</span>}
    </div>
  );
}

function art(hero: RulesHero, meta: GameMeta) {
  switch (hero.kind) {
    case 'cards':
      return hero.cards.map((text, i) => <PlayingCard key={text} card={cardOf(text)} className={`rules-hero__card rules-hero__card--${i + 1}`} testId="rules-hero-card" />);
    case 'canvas':
      return (
        <>
          <span className="rules-hero__canvas">
            <svg viewBox="0 0 84 62" width="84" height="62" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {DOODLE.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
          </span>
          <span className="rules-hero__pencil">
            <GameGlyph game={meta} size={34} strokeWidth={2} />
          </span>
        </>
      );
    case 'place':
      return (
        <>
          <span className="rules-hero__place">
            <svg viewBox="0 0 56 62" width="56" height="62" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {SKYLINE.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
          </span>
          <span className="rules-hero__spy">?</span>
        </>
      );
    case 'quips':
      return (
        <svg className="rules-hero__quips" viewBox="0 0 104 78" width="104" height="78" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* The first answer: an outlined bubble with two lines of text. */}
          <path d="M8 6h52a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H20l-8 8v-8H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" stroke="currentColor" fill="var(--color-surface)" />
          <path d="M14 15h30M14 23h20" stroke="currentColor" strokeOpacity="0.55" />
          {/* The answer that took the votes: filled with the accent, its lines in ink, a vote counter at its corner. */}
          <path d="M44 32h52a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4h-6v8l-8-8H44a4 4 0 0 1-4-4V36a4 4 0 0 1 4-4Z" fill="currentColor" stroke="var(--color-surface)" />
          <path d="M50 42h32M50 50h22" stroke="var(--game-ink)" strokeOpacity="0.75" />
          <circle cx="96" cy="34" r="9" fill="var(--color-surface)" stroke="currentColor" />
          <path d="M92 34l3 3 5-6" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      );
    case 'glyph':
      return (
        <span className="rules-hero__plate">
          <GameGlyph game={meta} size={30} strokeWidth={2} />
        </span>
      );
  }
}
