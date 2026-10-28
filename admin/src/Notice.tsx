import { useEffect, useState, type FormEvent } from 'react';
import { NOTICE_MAX_LENGTH, type Notice } from '@shared/platform/admin';
import { fetchNotice, saveNotice, SignedOut } from './api';
import { noOrphan } from './format';

/** The banner as the home page shows it: the text as text, never markup. */
export function NoticePreview({ text }: { text: string }) {
  return (
    <div className="site-notice" role="note" data-testid="notice-preview">
      {text}
    </div>
  );
}

/** A datetime-local value (the browser's own time zone) from epoch ms, and back. */
function toLocalInput(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const length = (text: string) => [...text.replace(/\s+/g, ' ').trim()].length;

function statusOf(notice: Notice | null, now: number): string {
  if (!notice || !notice.on) return 'Off: the home page shows no notice.';
  if (notice.expiresAt !== null && notice.expiresAt <= now) return 'Expired: the home page shows no notice.';
  return 'On: the home page shows this notice.';
}

/** The Notice tab: one short plain-text notice for the home page, on or off, with an optional expiry. */
export function NoticePage({ onSignedOut }: { onSignedOut(): void }) {
  const [saved, setSaved] = useState<Notice | null>(null);
  const [text, setText] = useState('');
  const [on, setOn] = useState(true);
  const [expires, setExpires] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'loading' });

  useEffect(() => {
    fetchNotice().then(
      (n) => {
        setSaved(n);
        if (n) {
          setText(n.text);
          setOn(n.on);
          setExpires(toLocalInput(n.expiresAt));
        }
        setState({ kind: 'idle' });
      },
      (err: unknown) => {
        if (err instanceof SignedOut) onSignedOut();
        else setState({ kind: 'error', message: 'Could not load the notice.' });
      },
    );
  }, [onSignedOut]);

  const count = length(text);
  const tooLong = count > NOTICE_MAX_LENGTH;
  const canSave = count > 0 && !tooLong && state.kind !== 'saving' && state.kind !== 'loading';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const input = { text, on, expiresAt: fromLocalInput(expires) };
    setState({ kind: 'saving' });
    saveNotice(input).then(
      () => {
        setSaved({ ...input, text: text.replace(/\s+/g, ' ').trim(), updatedAt: Date.now() });
        setState({ kind: 'saved' });
      },
      (err: unknown) => {
        if (err instanceof SignedOut) onSignedOut();
        else setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save the notice.' });
      },
    );
  };

  return (
    <div className="page" data-testid="notice-page">
      <p className="lede">{noOrphan(statusOf(saved, Date.now()))}</p>
      <form className="card section notice-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Notice</span>
          <input
            className="input"
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (state.kind === 'saved') setState({ kind: 'idle' });
            }}
            placeholder="Quick restart at 9pm"
            aria-describedby="notice-count"
            aria-invalid={tooLong || undefined}
            data-testid="notice-text"
          />
          <span className={`field__hint${tooLong ? ' is-over' : ''}`} id="notice-count" data-testid="notice-count">
            {count} of {NOTICE_MAX_LENGTH} characters
          </span>
        </label>

        <div className="field field--row">
          <span className="field__label" id="notice-on-label">
            Show it on the home page
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={on}
            aria-labelledby="notice-on-label"
            onClick={() => {
              setOn(!on);
              if (state.kind === 'saved') setState({ kind: 'idle' });
            }}
            data-testid="notice-on"
          >
            <span className="switch__thumb" aria-hidden="true" />
            <span className="switch__text">{on ? 'On' : 'Off'}</span>
          </button>
        </div>

        <label className="field">
          <span className="field__label">Ends at (optional)</span>
          <span className="field__inline">
            <input className="input" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="notice-expires" />
            {expires && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setExpires('')}>
                Clear
              </button>
            )}
          </span>
        </label>

        <div className="field">
          <span className="field__label">Preview</span>
          {count > 0 ? <NoticePreview text={text.replace(/\s+/g, ' ').trim()} /> : <p className="empty">Type a notice to see it here.</p>}
        </div>

        <div className="notice-form__actions">
          <button type="submit" className="btn btn--primary" disabled={!canSave} data-testid="notice-save">
            {state.kind === 'saving' ? 'Saving' : 'Save'}
          </button>
          {state.kind === 'saved' && (
            <p className="saved" role="status" data-testid="notice-saved">
              {noOrphan('Saved, it shows on the home page within a minute.')}
            </p>
          )}
          {state.kind === 'error' && (
            <p className="field__error" role="alert">
              {state.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
