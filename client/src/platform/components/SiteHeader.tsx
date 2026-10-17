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

/**
 * The logo (a link back to the front door) whose gear "o" in ".io" is the settings button. Inside
 * a room the logo link leaves it: routeSync leaves whenever the address bar stops naming the room.
 * The connection has its own notice (ConnectionNotice), never squeezed in beside the logo.
 */
export function SiteHeader({ hero = false }: Props) {
  return (
    <header className={`site-header${hero ? ' site-header--hero' : ''}`} data-testid="site-header">
      <div className="site-header__brand">
        <div className="logo" style={GEAR_VARS}>
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
          <SettingsMenu variant="logo" />
        </div>
      </div>
    </header>
  );
}
