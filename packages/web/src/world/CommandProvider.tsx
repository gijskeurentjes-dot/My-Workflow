import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Running commands against the server.
 *
 * Buttons need three things and all three live here: whether this particular
 * command is in flight, what to say when the server refuses it, and a
 * confirmation when something happened that is not otherwise visible on screen.
 *
 * Commands deliberately do not update local state. The server broadcasts the
 * same change over the event stream, so letting that one path do the updating
 * keeps every open screen in step and removes any chance of the two disagreeing.
 */

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'bad';
}

interface CommandContextValue {
  run(key: string, fn: () => Promise<unknown>, successMessage?: string): Promise<boolean>;
  /**
   * Say something that was not caused by a click.
   *
   * A live agent finishes, or fails, while you are looking at another screen —
   * that is worth a word, and it has no button to hang off.
   */
  notify(message: string, tone?: Toast['tone']): void;
  isPending(key: string): boolean;
  /** True while any command at all is in flight. */
  busy: boolean;
  toasts: Toast[];
  dismiss(id: number): void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Toast['tone']) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      // Errors stay longer, because they usually need reading twice.
      setTimeout(() => dismiss(id), tone === 'bad' ? 6000 : 2800);
    },
    [dismiss],
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, successMessage?: string) => {
      // Ignore a second click on a button that is already working.
      let alreadyRunning = false;
      setPending((current) => {
        if (current.has(key)) {
          alreadyRunning = true;
          return current;
        }
        const next = new Set(current);
        next.add(key);
        return next;
      });
      if (alreadyRunning) return false;

      try {
        await fn();
        if (successMessage) push(successMessage, 'ok');
        return true;
      } catch (err) {
        push(err instanceof Error ? err.message : 'That did not work.', 'bad');
        return false;
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [push],
  );

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'ok') => push(message, tone),
    [push],
  );

  const value = useMemo<CommandContextValue>(
    () => ({
      run,
      notify,
      isPending: (key: string) => pending.has(key),
      busy: pending.size > 0,
      toasts,
      dismiss,
    }),
    [run, notify, pending, toasts, dismiss],
  );

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommands(): CommandContextValue {
  const ctx = useContext(CommandContext);
  if (!ctx) throw new Error('useCommands must be used inside a <CommandProvider>');
  return ctx;
}
