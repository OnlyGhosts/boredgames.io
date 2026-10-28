import { useEffect, useState } from 'react';
import { noOrphan } from '../lib/format';
import { apiUrl } from '../net/server';

/** What GET /api/notice answers: the text while the notice is on, nothing otherwise. */
export type SiteNotice = { text?: unknown } | null;

/** The owner's notice (set in the admin dashboard), as a slim banner. Plain text only: React escapes it. */
export function NoticeBanner({ notice }: { notice: SiteNotice }) {
  const text = typeof notice?.text === 'string' ? notice.text.trim() : '';
  if (!text) return null;
  return (
    <p className="site-notice" role="status" data-testid="site-notice">
      {noOrphan(text)}
    </p>
  );
}

/** Asks for the notice once, after mount (the prerendered page never carries one). */
export function useSiteNotice(): SiteNotice {
  const [notice, setNotice] = useState<SiteNotice>(null);
  useEffect(() => {
    let live = true;
    fetch(apiUrl('/api/notice'))
      .then((res) => (res.ok ? (res.json() as Promise<SiteNotice>) : null))
      .then((body) => {
        if (live) setNotice(body);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return notice;
}
