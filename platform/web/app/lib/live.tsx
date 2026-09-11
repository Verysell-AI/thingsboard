import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { LIVE_SOCKET, type LiveEvent, type LiveSubscription } from '@platform/shared/contracts';
import type { LiveSnapshot } from '@platform/shared/dto';
import { getAccessToken } from './auth';
import { initialLiveState, liveReducer, type LiveState } from './live-store';

/**
 * One Socket.IO connection per page. WebSocket only (no polling) so several API replicas behind
 * nginx need no sticky sessions. On reconnect the last seen event id is sent so the server can
 * replay what was missed.
 */
function useLiveSocket(subscription?: LiveSubscription): LiveState {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);
  const lastEventIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const subscriptionKey = JSON.stringify(subscription ?? {});

  useEffect(() => {
    lastEventIdRef.current = state.lastEventId;
  }, [state.lastEventId]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socket = io({
      path: '/socket.io',
      transports: ['websocket'],
      auth: (cb) =>
        cb({
          [LIVE_SOCKET.authToken]: getAccessToken(),
          [LIVE_SOCKET.authLastEventId]: lastEventIdRef.current,
        }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      dispatch({ type: 'connected', connected: true });
      socket.emit(LIVE_SOCKET.subscribe, JSON.parse(subscriptionKey) as LiveSubscription);
    });
    socket.on('disconnect', () => dispatch({ type: 'connected', connected: false }));
    socket.on(LIVE_SOCKET.snapshot, (snapshot: LiveSnapshot) =>
      dispatch({ type: 'snapshot', snapshot }),
    );
    socket.on(LIVE_SOCKET.event, (event: LiveEvent) => dispatch({ type: 'event', event }));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [subscriptionKey]);

  return state;
}

const LiveContext = createContext<LiveState | null>(null);

/** Mounted once by the shell so the header clock and every page share one socket. */
export function LiveProvider({
  subscription,
  children,
}: {
  subscription?: LiveSubscription;
  children: ReactNode;
}) {
  const state = useLiveSocket(subscription);
  return <LiveContext value={state}>{children}</LiveContext>;
}

/** Live state of the tenant; outside a LiveProvider (tests) it is the disconnected initial state. */
export function useLive(): LiveState {
  return useContext(LiveContext) ?? initialLiveState;
}
