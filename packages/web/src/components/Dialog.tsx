import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A modal dialog.
 *
 * Escape closes it, a click outside closes it, focus moves in on open and back
 * to whatever opened it on close, and Tab is kept inside while it is up.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    // Focus the first thing worth typing into, falling back to the panel.
    const first = panel.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([data-secondary])',
    );
    (first ?? panel.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;

      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocusTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="modal-bg"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
      >
        <div className="modal-h">
          <h3>{title}</h3>
          {subtitle && (
            <p className="muted" style={{ marginTop: 5 }}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/** A labelled field. Keeps every form in the app laid out the same way. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      {children}
      {hint && (
        <p className="muted" style={{ marginTop: 5, fontSize: 11.5 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
