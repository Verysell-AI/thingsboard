import { createRng, parseHHMM } from '@platform/shared/behaviours';
import { zonedDateParts, zonedDayKey, zonedTimeToEpoch } from '@platform/shared/clock';
import type { Persona } from '@platform/shared/dataset';

export const DAY_MS = 24 * 3_600_000;
export const HOUR_SLOT_MS = 3_600_000;
export const FINE_SLOT_MS = 15 * 60_000;
/** The evening sweep has been live for this long; earlier weeks are the baseline. */
export const SWEEP_WEEKS = 4;
/** Recent weeks are written at 15-minute resolution, older ones hourly. */
export const FINE_WEEKS = 4;
/** Time everything is left on until before automation (the cleaners switch off). */
export const PRE_AUTOMATION_OFF_MIN = 23 * 60 + 30;
/** With the sweep at 20:00 and the late worker's zone kept until 21:30, the last room goes off here. */
export const AUTOMATION_OFF_MIN = 21 * 60 + 45;
export const SWEEP_MIN = 20 * 60;
export const PRECOOL_MIN = 30;
/** Minutes after a LATE booking's start before people arrive. */
export const LATE_ARRIVAL_MIN = 12;

export interface BackfillDay {
  date: string;
  dayStartMs: number;
  weekday: number;
  weekend: boolean;
  holiday: boolean;
  /** The evening sweep (and pre-cool) were active on this day. */
  sweepEra: boolean;
  slotMs: number;
  /** Before automation, some rooms stay on all weekend; decided per day. */
  forgottenWeekend: boolean;
}

/**
 * The synthetic calendar: every day from `weeks` ago up to (not including) today in the platform
 * zone, with weekends, two holidays (the Wednesday of the third and ninth week), the automation
 * era for the last SWEEP_WEEKS, and the slot resolution. Pure.
 */
export function buildCalendar(
  now: number,
  weeks: number,
  timeZone: string,
  seed = 'backfill',
): BackfillDay[] {
  const todayParts = zonedDateParts(now, timeZone);
  const todayStart = zonedTimeToEpoch({ ...todayParts, hour: 0, minute: 0, second: 0 }, timeZone);
  const sweepFrom = todayStart - SWEEP_WEEKS * 7 * DAY_MS;
  const fineFrom = todayStart - FINE_WEEKS * 7 * DAY_MS;
  const totalDays = weeks * 7;
  const holidayIndexes = new Set<number>();
  for (const week of [2, 8]) {
    if (week * 7 + 6 < totalDays) {
      // the Wednesday of that week
      for (let i = week * 7; i < week * 7 + 7; i++) {
        const wd = zonedDateParts(todayStart - (totalDays - i) * DAY_MS, timeZone).weekday;
        if (wd === 3) holidayIndexes.add(i);
      }
    }
  }
  const rng = createRng(`${seed}:weekends`);
  const days: BackfillDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const dayStartMs = zonedTimeToEpoch(
      { ...todayParts, day: todayParts.day - (totalDays - i), hour: 0, minute: 0, second: 0 },
      timeZone,
    );
    const parts = zonedDateParts(dayStartMs + 12 * 3_600_000, timeZone);
    const weekend = parts.weekday === 0 || parts.weekday === 6;
    const sweepEra = dayStartMs >= sweepFrom;
    days.push({
      date: zonedDayKey(dayStartMs + 12 * 3_600_000, timeZone),
      dayStartMs,
      weekday: parts.weekday,
      weekend,
      holiday: holidayIndexes.has(i),
      sweepEra,
      slotMs: dayStartMs >= fineFrom ? FINE_SLOT_MS : HOUR_SLOT_MS,
      forgottenWeekend: !sweepEra && (weekend || holidayIndexes.has(i)) && rng() < 0.25,
    });
  }
  return days;
}

export interface Schedule {
  /** Minutes of the day the person is at their desk, or null when absent. */
  arriveMin: number | null;
  leaveMin: number | null;
}

/** A person's presence on one day: persona hours with ±20 min jitter and an 8 % chance of absence. Pure. */
export function scheduleFor(
  persona: Persona,
  day: Pick<BackfillDay, 'weekend' | 'holiday' | 'date'>,
  seed: string,
): Schedule {
  if (day.weekend || day.holiday || persona.arrive === null || persona.leave === null)
    return { arriveMin: null, leaveMin: null };
  const rng = createRng(`${seed}:${day.date}`);
  if (rng() < 0.08) return { arriveMin: null, leaveMin: null };
  const jitter = () => Math.round((rng() * 2 - 1) * 20);
  return {
    arriveMin: Math.max(0, parseHHMM(persona.arrive) + jitter()),
    leaveMin: Math.min(24 * 60 - 1, parseHHMM(persona.leave) + jitter()),
  };
}

export function present(schedule: Schedule, minute: number): boolean {
  return (
    schedule.arriveMin !== null &&
    schedule.leaveMin !== null &&
    minute >= schedule.arriveMin &&
    minute < schedule.leaveMin
  );
}

export interface DayBooking {
  roomCode: string;
  startMin: number;
  endMin: number;
  attendance: 'FULL' | 'LATE' | 'GHOST';
  people: number;
}

/** People a booking brings into the room at `minute` (0 for ghosts and before a late start). Pure. */
export function bookingPeople(b: DayBooking, minute: number): number {
  if (minute < b.startMin || minute >= b.endMin) return 0;
  if (b.attendance === 'GHOST') return 0;
  if (b.attendance === 'LATE' && minute < b.startMin + LATE_ARRIVAL_MIN) return 0;
  return b.people;
}

export interface RoomDayInput {
  kind: string | null;
  critical: boolean;
  /** Minutes of the day at which someone is at a desk in the room (open plan). */
  deskPresence: (minute: number) => number;
  bookings: DayBooking[];
  /** First minute anyone is at a desk (open plan), computed once per day; null when nobody comes. */
  firstArrival?: number | null;
}

/** First minute of the day with someone at a desk, scanned in five-minute steps. Pure. */
export function firstArrivalOf(deskPresence: (minute: number) => number): number | null {
  for (let m = 5 * 60; m < 24 * 60; m += 5) if (deskPresence(m) > 0) return m;
  return null;
}

export interface RoomSlotPlan {
  occupied: boolean;
  people: number;
  booked: boolean;
  lightsOn: boolean;
  acOn: boolean;
}

/** When the room's lights and AC go off for the night on this day. */
export function offAtMinute(day: Pick<BackfillDay, 'sweepEra'>): number {
  return day.sweepEra ? AUTOMATION_OFF_MIN : PRE_AUTOMATION_OFF_MIN;
}

/**
 * What one room is doing at a minute of the day: who is in it, whether it is booked, and whether
 * lights and AC are on. Rooms come on with their first use and, before automation, stay on until
 * the cleaners leave at 23:30; in the automation era they are swept at 20:00 (the late worker's
 * zone lasts until 21:45). Pure.
 */
export function roomAt(
  room: RoomDayInput,
  day: Pick<BackfillDay, 'sweepEra' | 'weekend' | 'holiday' | 'forgottenWeekend'>,
  minute: number,
): RoomSlotPlan {
  const off = offAtMinute(day);
  const meetingPeople = room.bookings.reduce((n, b) => n + bookingPeople(b, minute), 0);
  const deskPeople = room.deskPresence(minute);
  const people = meetingPeople + deskPeople;
  const booked = room.bookings.some((b) => minute >= b.startMin && minute < b.endMin);
  const occupied = people > 0;
  const closed = day.weekend || day.holiday;

  if (room.kind === 'server' || room.critical) {
    return { occupied: false, people: 0, booked: false, lightsOn: false, acOn: true };
  }
  if (closed) {
    const on = day.forgottenWeekend && room.kind !== 'server';
    return { occupied: false, people: 0, booked: false, lightsOn: on, acOn: on };
  }
  let firstUse: number | null = null;
  switch (room.kind) {
    case 'meeting': {
      const first = room.bookings
        .filter((b) => b.attendance !== 'GHOST')
        .map((b) => b.startMin)
        .sort((a, b) => a - b)[0];
      firstUse = first ?? null;
      break;
    }
    case 'open_plan':
      firstUse =
        room.firstArrival !== undefined ? room.firstArrival : firstArrivalOf(room.deskPresence);
      break;
    case 'pantry':
      firstUse = 7 * 60 + 30;
      break;
    case 'reception':
      firstUse = 7 * 60;
      break;
    default:
      firstUse = 8 * 60;
  }
  const on = firstUse !== null && minute >= firstUse && minute < off;
  // pre-cool ahead of the first booking in the automation era
  const precool =
    day.sweepEra &&
    room.kind === 'meeting' &&
    firstUse !== null &&
    minute >= firstUse - PRECOOL_MIN &&
    minute < firstUse;
  return { occupied, people, booked, lightsOn: on, acOn: on || precool };
}
