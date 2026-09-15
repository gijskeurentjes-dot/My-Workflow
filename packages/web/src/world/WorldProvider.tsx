import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  SERVER_EVENT_TYPES,
  STREAM_PATH,
  type Agent,
  type DomainEvent,
  type DomainEventKind,
  type ServerEvent,
  type Task,
  type WorldSnapshot,
} from '@ai-islands/shared';
import { api } from '../api/client.js';

/**
 * The client's copy of the world.
 *
 * One Server-Sent Events connection feeds it. Every screen reads from here, so
 * the world view, the task board and the approval queue can never disagree
 * about what a bot is doing. When the mock engine is replaced by real agents,
 * the events keep the same shape and nothing in this file changes.
 */

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error';

interface State {
  world: WorldSnapshot | null;
  connection: ConnectionState;
  error: string | null;
  /**
   * True once loading the world has actually failed.
   *
   * Separate from `connection` because the two answer different questions and
   * kept disagreeing: the event stream retries forever, so it sits at
   * "reconnecting" indefinitely while the app has nothing to show — which read
   * to a person as "still loading", for ever. This says plainly that the first
   * load did not work, so the screen can say so and offer to try again.
   */
  loadFailed: boolean;
  /**
   * Why the first load failed, kept apart from `error`.
   *
   * The stream writes its own message into `error` every few seconds while it
   * retries, which would otherwise overwrite the one explaining why there is
   * nothing on screen at all.
   */
  loadError: string | null;
  /**
   * Server clock minus client clock, in ms. Added to `Date.now()` before
   * interpolating a walk, so an out-of-sync laptop does not teleport bots.
   */
  clockSkew: number;
}

type Action =
  | { type: 'snapshot'; world: WorldSnapshot }
  | { type: 'event'; event: ServerEvent }
  | { type: 'connection'; connection: ConnectionState; error?: string }
  | { type: 'load-failed'; error: string }
  | { type: 'retrying' };

const ACTIVITY_CAP = 200;

/** Replace rows by id, keeping the order of the existing list. */
function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing;
  const updates = new Map(incoming.map((row) => [row.id, row]));
  const merged = existing.map((row) => updates.get(row.id) ?? row);
  // Anything the server sent that we have not seen before is genuinely new.
  for (const row of incoming) {
    if (!existing.some((e) => e.id === row.id)) merged.push(row);
  }
  return merged;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'snapshot':
      return {
        ...state,
        world: action.world,
        connection: 'live',
        error: null,
        loadFailed: false,
        loadError: null,
        clockSkew: action.world.serverTime - Date.now(),
      };

    case 'connection':
      return { ...state, connection: action.connection, error: action.error ?? null };

    case 'load-failed':
      return { ...state, loadFailed: true, loadError: action.error };

    case 'retrying':
      return { ...state, loadFailed: false, loadError: null, connection: 'connecting' };

    case 'event': {
      const { event } = action;
      if (event.type === 'snapshot') {
        return {
          ...state,
          world: event.world,
          connection: 'live',
          error: null,
          clockSkew: event.world.serverTime - Date.now(),
        };
      }

      // Every other event is a delta, and a delta without a base is meaningless.
      const world = state.world;
      if (!world) return state;

      switch (event.type) {
        case 'tick':
          return {
            ...state,
            world: {
              ...world,
              agents: mergeById<Agent>(world.agents, event.agents),
              tasks: mergeById<Task>(world.tasks, event.tasks),
              stats: event.stats,
            },
          };

        case 'activity':
          return {
            ...state,
            world: {
              ...world,
              activity: [...event.events, ...world.activity].slice(0, ACTIVITY_CAP),
            },
          };

        case 'approvals':
          return { ...state, world: { ...world, approvals: event.approvals } };

        case 'events':
          // Named events say what happened; the rows in `tick` say what is now
          // true. Nothing is reduced into the world from here — subscribers are
          // notified instead, in the effect below.
          return state;

        case 'projects':
          return { ...state, world: { ...world, projects: event.projects } };

        case 'engine':
          return { ...state, world: { ...world, engine: event.engine } };

        case 'heartbeat':
          // Cheap, frequent, and the only place clock skew gets re-measured.
          return { ...state, clockSkew: event.at - Date.now() };

        default:
          return state;
      }
    }

    default:
      return state;
  }
}

type DomainEventHandler = (event: DomainEvent) => void;

interface WorldContextValue extends State {
  /** Server time, corrected for clock skew. Drives walk interpolation. */
  serverNow(): number;
  resetDemoData(): Promise<void>;
  resetting: boolean;
  /** Try loading the world again, after a failure. */
  retry(): Promise<void>;
  /** Subscribe to named events. Returns the unsubscribe function. */
  subscribe(handler: DomainEventHandler): () => void;
}

const WorldContext = createContext<WorldContextValue | null>(null);

export function WorldProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, {
    world: null,
    connection: 'connecting',
    error: null,
    loadFailed: false,
    loadError: null,
    clockSkew: 0,
  });
  const [resetting, setResetting] = useState(false);

  // Kept in a ref so `serverNow` is stable and does not re-render consumers.
  const skewRef = useRef(0);
  skewRef.current = state.clockSkew;

  // Subscribers live in a ref rather than state: a domain event should reach
  // the handful of components that care without re-rendering the whole world.
  const handlers = useRef(new Set<DomainEventHandler>());

  const subscribe = useCallback((handler: DomainEventHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    // EventSource reconnects on its own, so there is no retry loop here — only
    // a status flag so the UI can say the stream dropped.
    const source = new EventSource(STREAM_PATH);

    source.onopen = () => dispatch({ type: 'connection', connection: 'live' });

    const onFrame = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as ServerEvent;
        dispatch({ type: 'event', event });
        if (event.type === 'events') {
          for (const domainEvent of event.events) {
            for (const handler of handlers.current) handler(domainEvent);
          }
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    // The server names every event, and a named SSE event only reaches a
    // listener registered for that name — `onmessage` would never fire.
    for (const name of SERVER_EVENT_TYPES) {
      source.addEventListener(name, onFrame as EventListener);
    }

    source.onerror = () => {
      dispatch({
        type: 'connection',
        connection: source.readyState === EventSource.CLOSED ? 'error' : 'reconnecting',
        error: 'Lost the connection to the world. Retrying…',
      });
    };

    return () => {
      for (const name of SERVER_EVENT_TYPES) {
        source.removeEventListener(name, onFrame as EventListener);
      }
      source.close();
    };
  }, []);

  /**
   * Load the world directly.
   *
   * The stream normally delivers the first snapshot, but an old proxy can
   * buffer it, so this runs as a fallback — and it is also what the Retry
   * button calls, so "try again" is a real attempt rather than a page reload
   * and a hope.
   */
  const load = useCallback(async () => {
    try {
      dispatch({ type: 'snapshot', world: await api.world() });
    } catch (err: unknown) {
      dispatch({
        type: 'load-failed',
        error: err instanceof Error ? err.message : 'Could not reach the API',
      });
    }
  }, []);

  const retry = useCallback(async () => {
    dispatch({ type: 'retrying' });
    await load();
  }, [load]);

  useEffect(() => {
    if (state.world) return;
    const timer = setTimeout(() => void load(), 2500);
    return () => clearTimeout(timer);
  }, [state.world, load]);

  const serverNow = useCallback(() => Date.now() + skewRef.current, []);

  const resetDemoData = useCallback(async () => {
    setResetting(true);
    try {
      const world = await api.resetDemoData();
      dispatch({ type: 'snapshot', world });
    } finally {
      setResetting(false);
    }
  }, []);

  const value = useMemo<WorldContextValue>(
    () => ({ ...state, serverNow, resetDemoData, resetting, subscribe, retry }),
    [state, serverNow, resetDemoData, resetting, subscribe, retry],
  );

  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
}

export function useWorldContext(): WorldContextValue {
  const ctx = useContext(WorldContext);
  if (!ctx) throw new Error('useWorldContext must be used inside a <WorldProvider>');
  return ctx;
}

/**
 * The loaded world. Screens rendered inside `<WorldGate>` can rely on it being
 * present, which keeps every screen free of null checks.
 */
export function useWorld(): WorldSnapshot {
  const { world } = useWorldContext();
  if (!world) throw new Error('useWorld was called before the world finished loading');
  return world;
}

/**
 * React to named events without re-rendering on every one of them.
 *
 * Pass the kinds you care about; the handler is called for those only. The
 * handler is kept in a ref, so a component can use fresh props inside it
 * without re-subscribing on every render.
 */
export function useDomainEvents(
  kinds: readonly DomainEventKind[],
  handler: (event: DomainEvent) => void,
): void {
  const { subscribe } = useWorldContext();
  const latest = useRef(handler);
  latest.current = handler;

  // Joined so a caller can pass a fresh array literal without resubscribing.
  const key = kinds.join(',');

  useEffect(() => {
    const wanted = new Set(key.split(',') as DomainEventKind[]);
    return subscribe((event) => {
      if (wanted.has(event.kind)) latest.current(event);
    });
  }, [subscribe, key]);
}
