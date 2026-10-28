// The platform stylesheets come first so a game's stylesheet (imported by its module) can override them.
import './platform/styles/fonts.css';
import './platform/styles/tokens.css';
import './platform/styles/base.css';
import './platform/styles/components.css';
import './platform/styles/guess.css';
import './platform/styles/cards.css';
import './platform/styles/table.css';
import './platform/styles/gamebar.css';
import './platform/styles/results.css';
import './platform/styles/home.css';
import './platform/styles/lobby.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { GAMES } from './games';
import { sendVisit } from './platform/lib/beacon';
import { registerGames } from './platform/registry';

// Games import their own stylesheets; the platform never imports a game by name.
registerGames(GAMES);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);
// The build writes the front door into index.html as real HTML (scripts/prerender.ts): that markup
// is hydrated; any other page (a room link, the 404 page) is rendered afresh as before.
if (container.dataset.prerendered === window.location.pathname) hydrateRoot(container, tree);
else createRoot(container).render(tree);

// One cookieless visit count per page load (see lib/beacon.ts); a page the browser prerenders
// counts only once someone actually opens it.
const countVisit = () => sendVisit(window.location, document.referrer, window.innerWidth);
if ((document as Document & { prerendering?: boolean }).prerendering) document.addEventListener('prerenderingchange', countVisit, { once: true });
else countVisit();
