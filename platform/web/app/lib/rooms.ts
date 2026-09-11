import type { Booking, RoomStatus } from '@platform/shared/dto';
import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';

export const ROOM_STATUS_VARIANT: Record<RoomStatus, 'success' | 'secondary' | 'warning'> = {
  FREE: 'secondary',
  BUSY: 'success',
  BOOKED: 'warning',
};

/** Hours shown by the daily timeline. */
export const TIMELINE_START_HOUR = 8;
export const TIMELINE_END_HOUR = 20;

export interface TimelineBlock {
  booking: Booking;
  /** Percent offsets inside the band, 0..100. */
  start: number;
  width: number;
}

/** Local-day window of the timeline for a given business time, in the tenant zone. */
export function timelineWindow(nowMs: number, timeZone: string): { from: number; to: number } {
  const p = zonedDateParts(nowMs, timeZone);
  const from = zonedTimeToEpoch(
    { ...p, hour: TIMELINE_START_HOUR, minute: 0, second: 0 },
    timeZone,
  );
  const to = zonedTimeToEpoch({ ...p, hour: TIMELINE_END_HOUR, minute: 0, second: 0 }, timeZone);
  return { from, to };
}

/** Percent position of an instant inside a window, clamped to 0..100. */
export function timelinePercent(ms: number, window: { from: number; to: number }): number {
  const span = window.to - window.from;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((ms - window.from) / span) * 100));
}

/** Lays bookings out on the band; bookings outside the window are clipped or dropped. */
export function layoutBookings(
  bookings: Booking[],
  window: { from: number; to: number },
): TimelineBlock[] {
  const out: TimelineBlock[] = [];
  for (const b of bookings) {
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= window.from || s >= window.to) continue;
    const start = timelinePercent(s, window);
    const end = timelinePercent(e, window);
    out.push({ booking: b, start, width: Math.max(0.5, end - start) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Hour tick labels for the band. */
export function timelineHours(): number[] {
  const hours: number[] = [];
  for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h++) hours.push(h);
  return hours;
}

export const ATTENDANCE_COLOUR: Record<Booking['attendance'], string> = {
  FULL: 'bg-emerald-500',
  LATE: 'bg-amber-500',
  GHOST: 'bg-red-400',
};

/** ISO string for a wall-clock time today in the zone, for the booking form defaults. */
export function isoAtLocalTime(nowMs: number, timeZone: string, hhmm: string): string {
  const p = zonedDateParts(nowMs, timeZone);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(
    zonedTimeToEpoch({ ...p, hour: h ?? 0, minute: m ?? 0, second: 0 }, timeZone),
  ).toISOString();
}
