import { and, gte, inArray, lt } from 'drizzle-orm';
import { zonedDateParts, zonedDayKey } from '@platform/shared/clock';
import type { UtilisationReport, UtilisationRoom } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { bookings, locations, roomDailyStats, roomHourlyStats } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';

const DAY_MS = 24 * 3_600_000;
export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 18;
export const LOW_UTILISATION = 0.2;
export const HIGH_GHOST_RATE = 0.3;
const ROOM_KINDS = ['meeting', 'open_plan'];

export interface HourlyRow {
  date: string;
  hour: number;
  occupiedMinutes: number;
  bookedMinutes: number;
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. Pure. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** hour × weekday occupied share (0..1), averaged over the dates present for each weekday. Pure. */
export function heatmapFrom(rows: HourlyRow[]): number[][] {
  const sums = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const datesByWeekday = Array.from({ length: 7 }, () => new Set<string>());
  for (const r of rows) {
    const wd = weekdayOf(r.date);
    sums[wd]![r.hour] = (sums[wd]![r.hour] ?? 0) + Math.min(60, r.occupiedMinutes);
    datesByWeekday[wd]!.add(r.date);
  }
  return sums.map((hours, wd) => {
    const n = datesByWeekday[wd]!.size;
    return hours.map((m) => (n ? Math.round((m / (60 * n)) * 1000) / 1000 : 0));
  });
}

/** Share of weekday working hours (08–18) the room was occupied / booked. Pure. */
export function workingShares(
  rows: HourlyRow[],
  weekdays: number,
): { utilisation: number; booked: number } {
  const available = weekdays * (WORK_END_HOUR - WORK_START_HOUR) * 60;
  if (available <= 0) return { utilisation: 0, booked: 0 };
  let occ = 0;
  let booked = 0;
  for (const r of rows) {
    const wd = weekdayOf(r.date);
    if (wd === 0 || wd === 6 || r.hour < WORK_START_HOUR || r.hour >= WORK_END_HOUR) continue;
    occ += Math.min(60, r.occupiedMinutes);
    booked += Math.min(60, r.bookedMinutes);
  }
  return {
    utilisation: Math.round(Math.min(1, occ / available) * 1000) / 1000,
    booked: Math.round(Math.min(1, booked / available) * 1000) / 1000,
  };
}

export function recommendationFor(
  utilisation: number,
  ghostRate: number,
  kind: string | null,
): string | null {
  if (kind !== 'meeting') return null;
  if (ghostRate > HIGH_GHOST_RATE)
    return 'Ghost bookings are frequent: shorten the release grace or ask for check-in';
  if (utilisation < LOW_UTILISATION)
    return 'Rarely used: consider sharing, repurposing or making it bookable to other teams';
  return null;
}

/** Count of weekdays in [from, to) as YYYY-MM-DD strings. Pure. */
export function weekdaysBetween(fromMs: number, toMs: number, timeZone: string): number {
  let n = 0;
  for (let t = fromMs; t < toMs; t += DAY_MS) {
    const wd = zonedDateParts(t, timeZone).weekday;
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** Room utilisation over the last weeks from the hourly statistics, bookings and ghost counts. */
export class UtilisationService {
  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
  ) {}

  async report(tenant: { id: string }, weeks: number, now: number): Promise<UtilisationReport> {
    const fromMs = now - weeks * 7 * DAY_MS;
    const from = zonedDayKey(fromMs, this.timeZone);
    const to = zonedDayKey(now, this.timeZone);
    const { rooms, hourly, daily, bookingRows } = await withTenant(
      this.db,
      tenant.id,
      async (tx) => ({
        rooms: await tx
          .select({
            id: locations.id,
            code: locations.code,
            name: locations.name,
            kind: locations.kind,
            capacity: locations.capacity,
          })
          .from(locations)
          .where(and(inArray(locations.type, ['ROOM']), inArray(locations.kind, ROOM_KINDS)))
          .orderBy(locations.code),
        hourly: await tx
          .select()
          .from(roomHourlyStats)
          .where(and(gte(roomHourlyStats.date, from), lt(roomHourlyStats.date, to))),
        daily: await tx
          .select({ roomId: roomDailyStats.roomId, ghostCount: roomDailyStats.ghostCount })
          .from(roomDailyStats)
          .where(and(gte(roomDailyStats.date, from), lt(roomDailyStats.date, to))),
        bookingRows: await tx
          .select({ roomId: bookings.roomId })
          .from(bookings)
          .where(
            and(
              gte(bookings.start, new Date(fromMs)),
              lt(bookings.start, new Date(now)),
              inArray(bookings.status, ['ACTIVE', 'DONE', 'RELEASED']),
            ),
          ),
      }),
    );
    const weekdays = weekdaysBetween(fromMs, now, this.timeZone);
    const out: UtilisationRoom[] = rooms.map((room) => {
      const rows = hourly.filter((h) => h.roomId === room.id);
      const shares = workingShares(rows, weekdays);
      const ghosts = daily
        .filter((d) => d.roomId === room.id)
        .reduce((a, b) => a + b.ghostCount, 0);
      const bookingCount = bookingRows.filter((b) => b.roomId === room.id).length;
      const ghostRate = bookingCount ? Math.round((ghosts / bookingCount) * 1000) / 1000 : 0;
      return {
        roomId: room.id,
        code: room.code,
        name: room.name,
        capacity: room.capacity,
        utilisation: shares.utilisation,
        booked: shares.booked,
        ghostRate,
        heatmap: heatmapFrom(rows),
        recommendation: recommendationFor(shares.utilisation, ghostRate, room.kind),
      };
    });
    return { weeks, from, to, rooms: out };
  }
}
