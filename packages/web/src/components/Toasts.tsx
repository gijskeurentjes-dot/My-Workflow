import { useCommands } from '../world/CommandProvider.js';

/**
 * Command results.
 *
 * Errors are the important case: when the server refuses a transition it says
 * why, and that sentence is more useful than a disabled button ever is.
 */
export function Toasts() {
  const { toasts, dismiss } = useCommands();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span aria-hidden="true">{toast.tone === 'bad' ? '⚠' : '✓'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
          <button
            className="toast-x"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
