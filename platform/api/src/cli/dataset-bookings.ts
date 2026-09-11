import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import type { EmployeeSeed, Room } from '@platform/shared/dataset';
import type { BookingAttendance } from '@platform/shared/dto';
import { createRng } from '@platform/shared/behaviours';

/** Titles are the marker that a booking came from the dataset (re-runs replace them). */
export const DATASET_BOOKING_TITLES = [
  'Weekly sync',
  'Sprint planning',
  'Client call',
  'Design review',
  'Budget review',
  'Vendor meeting',
  'Hiring panel',
  'Quarterly planning',
  'Sales pipeline',
  'Incident review',
  'Onboarding session',
  'Team retrospective',
  'Marketing stand-up',
  'Contract negotiation',
  'Facilities walkthrough',
] as const;

export interface GeneratedBooking {
  roomCode: string;
  start: number;
  end: number;
  organiserCode: string;
  title: string;
  attendance: BookingAttendance;
}

export interface BookingCalendar {
  from: number;
  to: number;
  titles: string[];
  bookings: GeneratedBooking[];
}

const MINUTE = 60_000;
const DAY_START_MIN = 9 * 60;
const DAY_END_MIN = 18 * 60;

/**
 * Deterministic two-week meeting calendar (this business week and the next, Monday–Friday, in the
 * tenant zone): 2–5 bookings per meeting room per weekday in 30/60-minute slots between 09:00 and
 * 18:00, ~15 % ghosts and ~20 % late arrivals. Two anchors make the storyline reproducible: room
 * 1.2 has a 09:00 FULL meeting and room 1.4 a 10:00 GHOST meeting every weekday.
 */
export function generateBookingCalendar(input: {
  tenantKey: string;
  rooms: Room[];
  employees: EmployeeSeed[];
  now: number;
  timeZone: string;
}): BookingCalendar {
  const { timeZone } = input;
  const today = zonedDateParts(input.now, timeZone);
  const daysSinceMonday = (today.weekday + 6) % 7;
  const mondayDay = today.day - daysSinceMonday;
  const from = zonedTimeToEpoch(
    { ...today, day: mondayDay, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  const to = zonedTimeToEpoch(
    { ...today, day: mondayDay + 12, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  const meetingRooms = input.rooms.filter((r) => r.kind === 'meeting');
  const out: GeneratedBooking[] = [];
  if (input.employees.length === 0)
    return { from, to, titles: [...DATASET_BOOKING_TITLES], bookings: [] };

  for (let dayOffset = 0; dayOffset < 12; dayOffset++) {
    if (dayOffset % 7 >= 5) continue; // weekend
    const dayParts = { ...today, day: mondayDay + dayOffset };
    const at = (minute: number) =>
      zonedTimeToEpoch(
        { ...dayParts, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 },
        timeZone,
      );
    for (const room of meetingRooms) {
      const rng = createRng(`${input.tenantKey}:${room.code}:${dayOffset}`);
      const taken: [number, number][] = [];
      const push = (
        startMin: number,
        durationMin: number,
        attendance: BookingAttendance,
        titleIdx: number,
      ) => {
        const endMin = startMin + durationMin;
        if (endMin > DAY_END_MIN) return false;
        if (taken.some(([s, e]) => startMin < e && s < endMin)) return false;
        taken.push([startMin, endMin]);
        const organiser = input.employees[Math.floor(rng() * input.employees.length)]!;
        out.push({
          roomCode: room.code,
          start: at(startMin),
          end: at(endMin),
          organiserCode: organiser.code,
          title: DATASET_BOOKING_TITLES[titleIdx % DATASET_BOOKING_TITLES.length]!,
          attendance,
        });
        return true;
      };
      if (room.code === '1.2') push(DAY_START_MIN, 60, 'FULL', 0);
      if (room.code === '1.4') push(10 * 60, 60, 'GHOST', 2);
      const wanted = 2 + Math.floor(rng() * 4); // 2..5
      let attempts = 0;
      while (taken.length < wanted && attempts < 40) {
        attempts++;
        const slot = DAY_START_MIN + Math.floor(rng() * ((DAY_END_MIN - DAY_START_MIN) / 30)) * 30;
        const duration = rng() < 0.4 ? 30 : 60;
        const roll = rng();
        const attendance: BookingAttendance = roll < 0.15 ? 'GHOST' : roll < 0.35 ? 'LATE' : 'FULL';
        push(slot, duration, attendance, Math.floor(rng() * DATASET_BOOKING_TITLES.length));
      }
    }
  }
  out.sort((a, b) => a.start - b.start || a.roomCode.localeCompare(b.roomCode));
  return { from, to, titles: [...DATASET_BOOKING_TITLES], bookings: out };
}

export const BOOKING_SLOT_MS = 30 * MINUTE;
