import { useId, type CSSProperties, type ReactNode } from 'react';
import { cardOf } from '@shared/platform/cards';
import type { GameMeta } from '@shared/platform/games';
import type { RulesHero } from '../game';
import { GameGlyph } from './GameGlyph';
import { PlayingCard } from './PlayingCard';

/** The place card's skyline: a sun over three buildings with their windows, in a 56x62 box. */
const SKYLINE = ['M40 14a5 5 0 1 0 .1 0', 'M40 4v3M40 21v3M30 14h3M47 14h3', 'M5 50V34h10v-8h8v24', 'M27 50V24l7-6 7 6v26', 'M45 50V38h7v12', 'M2 50h52', 'M11 40h2M11 45h2M18 32h2M18 38h2M18 44h2M32 33h4v5h-4zM47 43h3'];

/**
 * The palette of a hero drawn in the tile pictures' flat style (GameArt.tsx): the game's accent and
 * the brand's lime as fills, the paper, and ink for details; every edge the deep cut of its own
 * fill's hue (`--game-accent-edge`, tokens.css), a paper shape borrowing the accent's. No grey, and
 * nothing black on the card's wash.
 */
export const HERO = {
  accent: 'var(--game-accent)',
  edge: 'var(--game-accent-edge)',
  lime: 'var(--color-primary)',
  limeEdge: 'var(--game-edge-lime)',
  paper: 'var(--game-paper)',
  ink: 'var(--game-ink)',
} as const;

/** How wide every edge is in a drawn hero, and how far its sticker shadow sits right and down: the tile pictures' 2.2, at the hero's scale. */
export const HERO_EDGE = 2.4;

/** The box every hero is drawn in (lobby.css's .rules-hero__art). */
export const HERO_VIEWBOX = '0 0 104 78';

/** A flat shape: its fill, the deep edge round it, and the edge once more as its sticker shadow's colour (`--edge`, lobby.css). */
function piece(fill: string, edge: string) {
  return { fill, stroke: edge, strokeWidth: HERO_EDGE, strokeLinejoin: 'round', strokeLinecap: 'round', style: { '--edge': edge } as CSSProperties } as const;
}

/** A detail inside a shape (a door, a line of text): ink or a deep edge colour, no edge of its own, and no shadow. */
function detail(fill: string) {
  return { fill, 'data-detail': '' } as const;
}

/**
 * A drawn hero: the drawing twice, first as its sticker shadow (each shape filled in its own edge
 * colour, offset right and down, the details left out: lobby.css), then itself.
 */
function Sticker({ defs, children }: { defs?: ReactNode; children: ReactNode }) {
  return (
    <svg className="rules-hero__drawing" viewBox={HERO_VIEWBOX} width="104" height="78" aria-hidden="true" focusable="false">
      {defs && <defs>{defs}</defs>}
      <g className="rules-hero__shadow" transform={`translate(${HERO_EDGE} ${HERO_EDGE})`}>
        {children}
      </g>
      <g>{children}</g>
    </svg>
  );
}

/**
 * Scribble: a paper canvas with a sun, a hill and a house on it, and the tile's marker (lime body,
 * accent cap, paper cone) drawing on its top right corner. The badge sits on the canvas's bottom
 * right corner, clear of the house, the sun and the marker (data-key marks them for the tests).
 */
function CanvasHero() {
  const clip = `hero-canvas-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Sticker
      defs={
        <clipPath id={clip}>
          <rect x="5.2" y="14.2" width="71.6" height="52.6" rx="6" />
        </clipPath>
      }
    >
      <rect x="4" y="13" width="74" height="55" rx="7" {...piece(HERO.paper, HERO.edge)} data-key="canvas" />
      <g clipPath={`url(#${clip})`} data-detail="">
        {/* The hill along the canvas's foot, cut to the canvas. */}
        <path d="M2 60c12-13 26-17 40-11s22 9 38 3v20H2z" {...piece(HERO.accent, HERO.edge)} />
      </g>
      <circle cx="20" cy="29" r="6.5" {...piece(HERO.lime, HERO.limeEdge)} data-detail="" data-key="sun" />
      {/* The house on the hill: paper walls, a lime roof, the door in the accent's edge. */}
      <g data-detail="" data-key="house">
        <rect x="27" y="40" width="14" height="12" rx="1" {...piece(HERO.paper, HERO.edge)} />
        <path d="M24.5 41.5 34 32.5l9.5 9z" {...piece(HERO.lime, HERO.limeEdge)} />
        <rect x="32" y="45" width="4" height="7" rx="1" {...detail(HERO.edge)} />
      </g>
      {/* The marker, tip on the canvas, body out past its corner: the tile picture's marker at the hero's size. */}
      <g transform="translate(53 37) rotate(-35)" data-key="marker">
        <rect x="14" y="-7" width="35" height="14" rx="2" {...piece(HERO.lime, HERO.limeEdge)} />
        <rect x="44" y="-8.5" width="10" height="17" rx="2" {...piece(HERO.accent, HERO.edge)} />
        <path d="M14 -7 0 0l14 7z" {...piece(HERO.paper, HERO.limeEdge)} />
        <path d="M2.6 0l6.4-3.2v6.4z" {...detail(HERO.edge)} />
      </g>
    </Sticker>
  );
}

/**
 * Quip Game: two answers head to head, a paper bubble and the accent one that took the votes, each
 * with its lines of text in ink, the lime vote tick on the winner's corner. The badge sits under the
 * accent bubble, beside the paper one, clear of both and of the tick.
 */
function QuipsHero() {
  return (
    <Sticker>
      <g data-key="winner">
        <path d="M46 5h44a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7h-6l1 6-8-6H46a7 7 0 0 1-7-7V12a7 7 0 0 1 7-7z" {...piece(HERO.accent, HERO.edge)} />
        <rect x="47" y="14" width="34" height="5" rx="2.5" {...detail(HERO.ink)} />
        <rect x="47" y="24" width="22" height="5" rx="2.5" {...detail(HERO.ink)} />
      </g>
      <g data-key="answer">
        <path d="M11 29h30a7 7 0 0 1 7 7v19a7 7 0 0 1-7 7H25l-10 9v-9h-4a7 7 0 0 1-7-7V36a7 7 0 0 1 7-7z" {...piece(HERO.paper, HERO.edge)} />
        <rect x="12" y="38" width="27" height="5" rx="2.5" {...detail(HERO.ink)} />
        <rect x="12" y="48" width="18" height="5" rx="2.5" {...detail(HERO.ink)} />
      </g>
      <g data-key="tick">
        <circle cx="93" cy="8" r="7.5" {...piece(HERO.lime, HERO.limeEdge)} />
        <path d="M88.3 8.4l1.7-1.7 2 2 4.2-4.2 1.7 1.7-5.9 5.9z" {...detail(HERO.ink)} />
      </g>
    </Sticker>
  );
}

interface Props {
  hero: RulesHero;
  meta: GameMeta;
}

/**
 * The illustration at the top of the How to play card, drawn by the platform from the game's
 * `hero` data (platform/game.ts) in its accent: the site's own playing cards, a canvas, a place
 * card and the spy's, two speech bubbles, or the glyph on its plate. The canvas and the bubbles are
 * drawn in the lobby tiles' flat style (HERO). Decorative (the facts say the numbers), inline SVG
 * and CSS only, so it renders on the server too.
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
      return <CanvasHero />;
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
      return <QuipsHero />;
    case 'glyph':
      return (
        <span className="rules-hero__plate">
          <GameGlyph game={meta} size={30} strokeWidth={2} />
        </span>
      );
  }
}
