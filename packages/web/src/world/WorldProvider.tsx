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
  type ActivityEvent,
  type Bot,
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
   * Server clock minus client clock, in ms. Added to `Date.now()` before
   * interpolating a walk, so an out-of-sync laptop does not teleport bots.
   */
  clockSkew: number;
}

type Action =
  | { type: 'snapshot'; world: WorldSnapshot }
  | { type: 'event'; event: ServerEvent }
  | { type: 'connection'; connection: ConnectionState; error?: string };

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
        clockSkew: action.world.serverTime - Date.now(),
      };

    case 'connection':
      return { ...state, connection: action.connection, error: action.error ?? null };

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
              bots: mergeById<Bot>(world.bots, event.bots),
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

        case 'islands':
          return { ...state, world: { ...world, islands: event.islands } };

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

interface WorldContextValue extends State {
  /** Server time, corrected for clock skew. Drives walk interpolation. */
  serverNow(): number;
  resetDemoData(): Promise<void>;
  resetting: boolean;
}

const WorldContext = createContext<WorldContextValue | null>(null);

export function WorldProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, {
    world: null,
    connection: 'connecting',
    error: null,
    clockSkew: 0,
  });
  const [resetting, setResetting] = useState(false);

  // Kept in a ref so `serverNow` is stable and does not re-render consumers.
  const skewRef = useRef(0);
  skewRef.current = state.clockSkew;

  useEffect(() => {
    // EventSource reconnects on its own, so there is no retry loop here — only
    // a status flag so the UI can say the stream dropped.
    const source = new EventSource(STREAM_PATH);

    source.onopen = () => dispatch({ type: 'connection', connection: 'live' });

    const onFrame = (message: MessageEvent<string>) => {
      try {
        dispatch({ type: 'event', event: JSON.parse(message.data) as ServerEvent });
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

  // If the stream never delivers a snapshot — an old proxy buffering it, say —
  // fall back to a plain fetch so the app still renders.
  useEffect(() => {
    if (state.world) return;
    const timer = setTimeout(() => {
      api
        .world()
        .then((world) => dispatch({ type: 'snapshot', world }))
        .catch((err: unknown) =>
          dispatch({
            type: 'connection',
            connection: 'error',
            error: err instanceof Error ? err.message : 'Could not reach the API',
          }),
        );
    }, 2500);
    return () => clearTimeout(timer);
  }, [state.world]);

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
    () => ({ ...state, serverNow, resetDemoData, resetting }),
    [state, serverNow, resetDemoData, resetting],
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
