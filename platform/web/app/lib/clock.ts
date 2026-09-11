import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ClockSnapshotSchema,
  isLiveClock,
  liveClock,
  virtualNow,
  zonedDateParts,
  type ClockCommand,
  type ClockSnapshot,
  type ClockState,
} from '@platform/shared/clock';
import { api } from './api';
import { useLive } from './live';

export const CLOCK_QUERY_KEY = ['clock'] as const;

export interface BusinessClock {
  /** Current business time in ms (virtual when the time machine is active). */
  now: number;
  state: ClockState;
  timeZone: string;
  live: boolean;
  speed: number;
  /** False until the API answered for a demo tenant; non-demo tenants are always ready. */
  ready: boolean;
}

/** Re-renders every second while mounted. */
function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The tenant's business clock. Demo tenants load it from the API and follow `clock` live events;
 * other tenants simply read the real time in the tenant zone. Wall-clock fields are always taken
 * in `timeZone`, never in the browser's zone.
 */
export function useBusinessClock(opts: { demoMode: boolean; timeZone: string }): BusinessClock {
  const live = useLive();
  const query = useQuery({
    queryKey: CLOCK_QUERY_KEY,
    queryFn: () => api.get('/clock', ClockSnapshotSchema),
    enabled: opts.demoMode,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const realNow = useTicker();

  const fromEvent: ClockSnapshot | null = live.clock
    ? {
        tenantKey: live.clock.tenantKey,
        state: live.clock.state,
        realNow: live.clock.ts,
        virtualNow: live.clock.virtualNow,
        live: isLiveClock(live.clock.state),
        timeZone: live.clock.timeZone,
      }
    : null;
  const fromQuery = query.data ?? null;
  const snapshot =
    fromEvent && (!fromQuery || fromEvent.realNow >= fromQuery.realNow) ? fromEvent : fromQuery;

  if (!opts.demoMode) {
    return {
      now: realNow,
      state: liveClock(),
      timeZone: opts.timeZone,
      live: true,
      speed: 1,
      ready: true,
    };
  }
  const state = snapshot?.state ?? liveClock();
  return {
    now: virtualNow(state, realNow),
    state,
    timeZone: snapshot?.timeZone ?? opts.timeZone,
    live: isLiveClock(state),
    speed: state.speed,
    ready: snapshot !== null,
  };
}

/** Sends a time-machine command; the answer replaces the cached snapshot immediately. */
export function useClockCommand() {
  const queryClient = useQueryClient();
  return async (command: ClockCommand): Promise<ClockSnapshot> => {
    const snapshot = await api.post('/clock', command, ClockSnapshotSchema);
    queryClient.setQueryData(CLOCK_QUERY_KEY, snapshot);
    return snapshot;
  };
}

/** HH:MM(:SS) in the zone, using the locale's digits and separators. */
export function formatClockTime(
  ms: number,
  timeZone: string,
  locale: string,
  opts: { seconds?: boolean } = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.seconds === false ? {} : { second: '2-digit' }),
  }).format(new Date(ms));
}

/** "Mon 7 Sep" style date in the zone. */
export function formatClockDate(ms: number, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(ms));
}

/** "HH:MM" for a time input, in the zone. */
export function clockTimeInputValue(ms: number, timeZone: string): string {
  const p = zonedDateParts(ms, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
