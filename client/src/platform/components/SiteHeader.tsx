import type { CSSProperties } from 'react';
import { WORDMARK_GEAR_POSITION } from '../brand/wordmark';
import { navigate } from '../router';
import { SettingsMenu } from './Preferences';
import { Wordmark } from './Wordmark';

interface Props {
  /** The front door's header: the logo fills the header's width. */
  hero?: boolean;
}

/** Where the gear "o" sits in the logo's box, for the settings button and its popover. */
const GEAR_VARS = { '--gear-x': WORDMARK_GEAR_POSITION.left, '--gear-y': WORDMARK_GEAR_POSITION.top } as CSSProperties;

interface LogoProps {
  /**
   * In a game: the logo asks first. It opens the leave confirm (the same as the bar's Leave)
   * instead of linking to the front door, so it never drops a player out of a game silently.
   */
  leave?: { open: boolean; onOpen(): void };
}

/**
 * The logo whose gear "o" in ".io" is the settings button (theme and sound). Outside a game the
 * logo is a link back to the front door; inside a room that link leaves it (routeSync leaves
 * whenever the address bar stops naming the room). In a game it opens the leave confirm instead.
 */
export function Logo({ leave }: LogoProps) {
  return (
    <div className="logo" style={GEAR_VARS}>
      {leave ? (
        <button type="button" className="brand" onClick={leave.onOpen} aria-haspopup="dialog" aria-expanded={leave.open} aria-label="boredgames.io home: leave the room" data-testid="brand-link">
          <Wordmark />
        </button>
      ) : (
        <a
          className="brand"
          href="/"
          data-testid="brand-link"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <Wordmark />
        </a>
      )}
      <SettingsMenu />
    </div>
  );
}

/**
 * The site's header: the logo with its gear. The connection has its own notice
 * (ConnectionNotice), never squeezed in beside the logo.
 */
export function SiteHeader({ hero = false }: Props) {
  return (
    <header className={`site-header${hero ? ' site-header--hero' : ''}`} data-testid="site-header">
      <div className="site-header__brand">
        <Logo />
      </div>
    </header>
  );
}
