import { z } from 'zod';

/**
 * Business clock ("time machine") shared by the API, the simulator and the web.
 *
 * Every tenant has one clock. In live mode it equals the real clock. A demo operator can jump it to
 * another moment or run it faster than real time; personas, automations and bookings follow it,
 * while device telemetry keeps real timestamps so ThingsBoard history and dashboards stay coherent.
 *
 * The state is an anchor, not a counter: at real time `anchorRealMs` the virtual time was
 * `anchorVirtualMs`, and it advances at `speed` virtual seconds per real second. Any process can
 * compute the current virtual time from the state and its own real clock, so nothing has to tick.
 */

/** IANA zone every wall-clock rule (personas, "20:00 sweep") is expressed in. */
export const DEFAULT_TIME_ZONE = 'Asia/Dubai';

/** Speeds offered by the console; the API accepts any value in [0, CLOCK_MAX_SPEED]. */
export const CLOCK_SPEEDS = [1, 10, 60, 300] as const;
export const CLOCK_MAX_SPEED = 600;
/** Largest jump the API accepts in one command (a week forward, a day back). */
export const CLOCK_MAX_JUMP_FORWARD_MS = 7 * 24 * 3_600_000;
export const CLOCK_MAX_JUMP_BACK_MS = 24 * 3_600_000;

export const ClockStateSchema = z.object({
  /** Real time (ms since epoch) at which the virtual time was `anchorVirtualMs`. */
  anchorRealMs: z.number().int().nonnegative(),
  anchorVirtualMs: z.number().int().nonnegative(),
  /** Virtual seconds per real second; 0 pauses the clock, 1 is real time. */
  speed: z.number().min(0).max(CLOCK_MAX_SPEED),
});
export type ClockState = z.infer<typeof ClockStateSchema>;

/** A clock that reads the real time. */
export function liveClock(): ClockState {
  return { anchorRealMs: 0, anchorVirtualMs: 0, speed: 1 };
}

export function isLiveClock(state: ClockState): boolean {
  return state.speed === 1 && state.anchorRealMs === state.anchorVirtualMs;
}

/** Virtual time for the given real time. */
export function virtualNow(state: ClockState, realNowMs: number): number {
  return Math.round(state.anchorVirtualMs + (realNowMs - state.anchorRealMs) * state.speed);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const ClockCommandSchema = z.discriminatedUnion('op', [
  /** Move to an absolute moment. */
  z.object({ op: z.literal('jumpTo'), at: z.number().int().nonnegative() }),
  /** Move to a wall-clock time in the tenant's zone, on the current virtual day plus `dayOffset`. */
  z.object({
    op: z.literal('jumpToTime'),
    time: z.string().regex(HHMM, 'expected HH:MM'),
    dayOffset: z.number().int().min(-1).max(7).default(0),
  }),
  /** Move forward (or back) by a duration. */
  z.object({
    op: z.literal('jumpBy'),
    ms: z.number().int().min(-CLOCK_MAX_JUMP_BACK_MS).max(CLOCK_MAX_JUMP_FORWARD_MS),
  }),
  /** Change how fast virtual time passes; 0 pauses. */
  z.object({ op: z.literal('speed'), speed: z.number().min(0).max(CLOCK_MAX_SPEED) }),
  /** Back to the real clock. */
  z.object({ op: z.literal('reset') }),
]);
export type ClockCommand = z.infer<typeof ClockCommandSchema>;

/** What the API returns and pushes to browsers. */
export const ClockSnapshotSchema = z.object({
  tenantKey: z.string(),
  state: ClockStateSchema,
  realNow: z.number().int(),
  virtualNow: z.number().int(),
  live: z.boolean(),
  timeZone: z.string(),
});
export type ClockSnapshot = z.infer<typeof ClockSnapshotSchema>;

export function clockSnapshot(
  tenantKey: string,
  state: ClockState,
  realNowMs: number,
  timeZone: string,
): ClockSnapshot {
  return {
    tenantKey,
    state,
    realNow: realNowMs,
    virtualNow: virtualNow(state, realNowMs),
    live: isLiveClock(state),
    timeZone,
  };
}

/** Pure transition: the new state after a command, anchored at `realNowMs`. */
export function applyClockCommand(
  state: ClockState,
  command: ClockCommand,
  realNowMs: number,
  timeZone: string,
): ClockState {
  const current = virtualNow(state, realNowMs);
  switch (command.op) {
    case 'jumpTo':
      return { anchorRealMs: realNowMs, anchorVirtualMs: command.at, speed: state.speed };
    case 'jumpBy':
      return {
        anchorRealMs: realNowMs,
        anchorVirtualMs: Math.max(0, current + command.ms),
        speed: state.speed,
      };
    case 'jumpToTime': {
      const parts = zonedDateParts(current, timeZone);
      const [h, m] = command.time.split(':').map(Number) as [number, number];
      const at = zonedTimeToEpoch(
        { ...parts, day: parts.day + command.dayOffset, hour: h, minute: m, second: 0 },
        timeZone,
      );
      return { anchorRealMs: realNowMs, anchorVirtualMs: at, speed: state.speed };
    }
    case 'speed':
      return { anchorRealMs: realNowMs, anchorVirtualMs: current, speed: command.speed };
    case 'reset':
      return liveClock();
  }
}

/* ---------------------------------------------------------------------------------------------
 * Zone-aware wall-clock helpers. Kept dependency-free (Intl only) so the browser, the API and the
 * simulator agree on "20:00 in Dubai" regardless of the process or device time zone.
 * ------------------------------------------------------------------------------------------- */

export interface ZonedParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Calendar fields of an instant in a zone. */
export function zonedDateParts(ms: number, timeZone: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: 0 };
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    switch (part.type) {
      case 'year':
        out.year = Number(part.value);
        break;
      case 'month':
        out.month = Number(part.value);
        break;
      case 'day':
        out.day = Number(part.value);
        break;
      case 'hour':
        out.hour = Number(part.value) % 24;
        break;
      case 'minute':
        out.minute = Number(part.value);
        break;
      case 'second':
        out.second = Number(part.value);
        break;
      case 'weekday':
        out.weekday = WEEKDAYS[part.value] ?? 0;
        break;
    }
  }
  return out;
}

/** Minutes after local midnight in the zone. */
export function zonedMinutesOfDay(ms: number, timeZone: string): number {
  const p = zonedDateParts(ms, timeZone);
  return p.hour * 60 + p.minute;
}

/** Local calendar date in the zone as YYYY-MM-DD; compares equal to ISO dates and holiday lists. */
export function zonedDayKey(ms: number, timeZone: string): string {
  const p = zonedDateParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function isZonedWeekend(ms: number, timeZone: string): boolean {
  const d = zonedDateParts(ms, timeZone).weekday;
  return d === 0 || d === 6;
}

/**
 * Instant for calendar fields in a zone. `day` may overflow the month (day 32 rolls into the next
 * month) so callers can add day offsets without calendar arithmetic. Two correction passes handle
 * zones with daylight saving.
 */
export function zonedTimeToEpoch(
  fields: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute'> &
    Partial<Pick<ZonedParts, 'second'>>,
  timeZone: string,
): number {
  const wanted = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second ?? 0,
  );
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = zonedDateParts(guess, timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wanted - seen;
  }
  return guess;
}

/** Offset of the zone from UTC at an instant, in minutes (Dubai: 240). */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const p = zonedDateParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}
