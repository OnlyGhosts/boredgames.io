import { useCallback, useEffect, useState } from 'react';
import { Wordmark } from '../../client/src/platform/components/Wordmark';
import { AnalyticsPage } from './Analytics';
import { fetchSummary, login, logout, SignedOut, type LoginError } from './api';
import { LoginView } from './Login';
import { NoticePage } from './Notice';
import { RoomsPage } from './Rooms';

type Tab = 'analytics' | 'rooms' | 'notice';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'rooms', label: 'Live rooms' },
  { id: 'notice', label: 'Notice' },
];

/** The page the hash names: `#rooms`, or `#analytics/2026-10-29` (Analytics keeps its day or range after the slash). */
function tabFromHash(): Tab {
  const hash = typeof location === 'undefined' ? '' : (location.hash.slice(1).split('/')[0] ?? '');
  return TABS.some((t) => t.id === hash) ? (hash as Tab) : 'analytics';
}

export function App() {
  const [auth, setAuth] = useState<'checking' | 'out' | 'in'>('checking');
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSummary('today').then(
      () => setAuth('in'),
      (err: unknown) => setAuth(err instanceof SignedOut ? 'out' : 'in'),
    );
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const signedOut = useCallback(() => setAuth('out'), []);

  const signIn = (password: string) => {
    setBusy(true);
    login(password).then((error) => {
      setBusy(false);
      setLoginError(error);
      if (!error) setAuth('in');
    });
  };

  const signOut = () => {
    void logout().then(() => {
      setLoginError(null);
      setAuth('out');
    });
  };

  if (auth === 'checking') return <p className="loading">Loading</p>;
  if (auth === 'out') return <LoginView error={loginError} busy={busy} onSubmit={signIn} />;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar__brand">
          <Wordmark />
          <span className="topbar__tag">admin</span>
        </span>
        <nav className="tabs" aria-label="Admin pages">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="tabs__item" aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
              {t.label}
            </a>
          ))}
        </nav>
        <button type="button" className="btn btn--ghost btn--sm topbar__out" onClick={signOut} data-testid="admin-sign-out">
          Sign out
        </button>
      </header>
      <main className="main">
        <h1 className="sr-only">{TABS.find((t) => t.id === tab)?.label}</h1>
        {tab === 'analytics' && <AnalyticsPage onSignedOut={signedOut} />}
        {tab === 'rooms' && <RoomsPage onSignedOut={signedOut} />}
        {tab === 'notice' && <NoticePage onSignedOut={signedOut} />}
      </main>
    </div>
  );
}
