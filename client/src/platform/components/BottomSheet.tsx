import { useRef, type ReactNode } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { useScrollFade } from '../lib/useScrollFade';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  testId: string;
  /** Extra class on the sheet (a narrower panel on a desktop, say). */
  className?: string;
  /** The dialog's accessible name when it should say more than the title ("How to play Poker" over "How to play"). */
  label?: string;
  /**
   * The body says what the sheet is (a confirm step's own question, "Leave the room?"), so the head
   * shows the close button alone, over the panel's corner, and the title only names the dialog.
   */
  hideTitle?: boolean;
}

/**
 * Phone-style bottom sheet: dimmed backdrop, close button, tap outside or Escape to dismiss.
 * A modal dialog for keyboard and screen-reader users too: it takes the focus when it opens,
 * keeps Tab inside the panel and hands the focus back to the control that opened it. Its body
 * scrolls when the sheet is full (a long players list, a short screen), each end with more to
 * read fading into the sheet, so a row cut at the edge reads as a scroll.
 */
export function BottomSheet({ open, title, onClose, children, testId, className, label, hideTitle = false }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(panelRef, open, onClose);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [fade] = useScrollFade(bodyRef, open);

  if (!open) return null;
  return (
    <div className={`sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title} data-testid={testId}>
      <button type="button" className="sheet__backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} data-testid={`${testId}-backdrop`} />
      <div className="sheet__panel" ref={panelRef} tabIndex={-1}>
        <div className="sheet__handle" aria-hidden="true" />
        <header className={`sheet__head${hideTitle ? ' sheet__head--bare' : ''}`}>
          {!hideTitle && <h2 className="sheet__title">{title}</h2>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" data-testid={`${testId}-close`}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="sheet__body scroll-fade" ref={bodyRef} data-fade={fade}>
          {children}
        </div>
      </div>
    </div>
  );
}
