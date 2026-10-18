import { useId } from 'react';
import {
  WORDMARK_ACCENT_PATH,
  WORDMARK_BASE_PATH,
  WORDMARK_GEAR_PATH,
  WORDMARK_ICON_TRANSFORM,
  WORDMARK_VIEWBOX,
} from '../brand/wordmark';
import { BoredArt, HappyArt, MASCOTS_VIEWBOX } from './Mascots';

interface WordmarkProps {
  className?: string;
  /**
   * 'full' (default): the two phones and the text. 'icon': the two phones alone, on their own
   * artboard (a phone's game bar, where the game's name, the code and the menu share the line).
   */
  variant?: 'full' | 'icon';
}

/**
 * The boredgames.io logo: the two phones as an icon, as tall as the text, then the outlined
 * Poppins wordmark whose "o" in ".io" is a settings gear (the site header lays its settings button
 * over it), inline so the theme recolours it. "bored" and ".io" take the text colour, "games"
 * the lime (cut darker on light); the phones keep their own colours. Height comes from CSS; the
 * viewBox keeps the proportions.
 */
export function Wordmark({ className, variant = 'full' }: WordmarkProps) {
  const titleId = useId();
  if (variant === 'icon') {
    return (
      <svg className={`wordmark wordmark--icon${className ? ` ${className}` : ''}`} viewBox={MASCOTS_VIEWBOX} role="img" aria-labelledby={titleId} data-testid="wordmark">
        <title id={titleId}>boredgames.io</title>
        <BoredArt />
        <HappyArt />
      </svg>
    );
  }
  return (
    <svg className={`wordmark${className ? ` ${className}` : ''}`} viewBox={WORDMARK_VIEWBOX} role="img" aria-labelledby={titleId} data-testid="wordmark">
      <title id={titleId}>boredgames.io</title>
      <g className="wordmark__icon" transform={WORDMARK_ICON_TRANSFORM}>
        <BoredArt />
        <HappyArt />
      </g>
      <path d={WORDMARK_BASE_PATH} fill="currentColor" />
      <path className="wordmark__accent" d={WORDMARK_ACCENT_PATH} fill="currentColor" />
      <path className="wordmark__gear" d={WORDMARK_GEAR_PATH} fill="currentColor" />
    </svg>
  );
}
