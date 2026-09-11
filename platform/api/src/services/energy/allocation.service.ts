import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import type { EnergyCostReport, EnergyCostRow } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { bookings, employees, locations, roomDailyStats } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';

export const SHARED_DEPARTMENT = 'Shared';

/**
 * Splits one room-day's kWh across departments: open plans by the desks' departments, meeting
 * rooms by the organisers' booked minutes, everything else (pantry, reception, server room) to
 * Shared. Pure.
 */
export function allocateRoomDay(
  kwh: number,
  kind: string | null,
  deskDepartments: Record<string, number>,
  bookedMinutesByDepartment: Record<string, number>,
): Record<string, number> {
  if (!(kwh > 0)) return {};
  const weights =
    kind === 'open_plan' ? deskDepartments : kind === 'meeting' ? bookedMinutesByDepartment : {};
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total <= 0) return { [SHARED_DEPARTMENT]: kwh };
  const out: Record<string, number> = {};
  for (const [dept, w] of Object.entries(weights)) if (w > 0) out[dept] = (kwh * w) / total;
  return out;
}

/** The `months` calendar months ending with the one containing `now`, oldest first, as YYYY-MM. */
export function monthKeys(now: number, months: number, timeZone: string): string[] {
  const p = zonedDateParts(now, timeZone);
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    let y = p.year;
    let m = p.month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** Energy cost per department per month from the room daily statistics and the bookings. */
export class AllocationService {
  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
  ) {}

  async report(
    tenant: { id: string; currency: string; tariffPerKwh: number },
    months: number,
    now: number,
  ): Promise<EnergyCostReport> {
    const keys = monthKeys(now, months, this.timeZone);
    const [fy, fm] = keys[0]!.split('-').map(Number);
    const p = zonedDateParts(now, this.timeZone);
    const fromMs = zonedTimeToEpoch(
      { ...p, year: fy!, month: fm!, day: 1, hour: 0, minute: 0, second: 0 },
      this.timeZone,
    );
    const fromDate = `${keys[0]}-01`;
    const { stats, rooms, desks, bookingRows } = await withTenant(
      this.db,
      tenant.id,
      async (tx) => {
        const rooms = await tx
          .select({ id: locations.id, kind: locations.kind })
          .from(locations)
          .where(inArray(locations.type, ['ROOM']));
        return {
          rooms,
          stats: await tx
            .select({
              roomId: roomDailyStats.roomId,
              date: roomDailyStats.date,
              kwh: roomDailyStats.kwh,
            })
            .from(roomDailyStats)
            .where(gte(roomDailyStats.date, fromDate)),
          desks: await tx
            .select({ deskRoomId: employees.deskRoomId, department: employees.department })
            .from(employees),
          bookingRows: await tx
            .select({
              roomId: bookings.roomId,
              start: bookings.start,
              end: bookings.end,
              department: employees.department,
            })
            .from(bookings)
            .leftJoin(employees, eq(employees.id, bookings.organiserId))
            .where(
              and(
                gte(bookings.start, new Date(fromMs)),
                lt(bookings.start, new Date(now)),
                inArray(bookings.status, ['ACTIVE', 'DONE']),
              ),
            ),
        };
      },
    );
    const kindByRoom = new Map(rooms.map((r) => [r.id, r.kind]));
    const desksByRoom = new Map<string, Record<string, number>>();
    for (const d of desks) {
      if (!d.deskRoomId) continue;
      const m = desksByRoom.get(d.deskRoomId) ?? {};
      m[d.department] = (m[d.department] ?? 0) + 1;
      desksByRoom.set(d.deskRoomId, m);
    }
    // booked minutes per room per business day per organiser department
    const bookedByRoomDay = new Map<string, Record<string, number>>();
    for (const b of bookingRows) {
      const day = dayKeyOf(b.start.getTime(), this.timeZone);
      const key = `${b.roomId}:${day}`;
      const m = bookedByRoomDay.get(key) ?? {};
      const dept = b.department ?? SHARED_DEPARTMENT;
      m[dept] = (m[dept] ?? 0) + Math.max(0, (b.end.getTime() - b.start.getTime()) / 60_000);
      bookedByRoomDay.set(key, m);
    }
    const totals = new Map<string, Map<string, number>>(); // month → dept → kwh
    for (const s of stats) {
      const month = s.date.slice(0, 7);
      if (!keys.includes(month)) continue;
      const split = allocateRoomDay(
        Number(s.kwh),
        kindByRoom.get(s.roomId) ?? null,
        desksByRoom.get(s.roomId) ?? {},
        bookedByRoomDay.get(`${s.roomId}:${s.date}`) ?? {},
      );
      const m = totals.get(month) ?? new Map<string, number>();
      for (const [dept, kwh] of Object.entries(split)) m.set(dept, (m.get(dept) ?? 0) + kwh);
      totals.set(month, m);
    }
    const departments = [...new Set([...totals.values()].flatMap((m) => [...m.keys()]))].sort(
      (a, b) => (a === SHARED_DEPARTMENT ? 1 : b === SHARED_DEPARTMENT ? -1 : a.localeCompare(b)),
    );
    const rows: EnergyCostRow[] = [];
    const monthTotals: EnergyCostReport['totals'] = [];
    for (const month of keys) {
      const m = totals.get(month) ?? new Map<string, number>();
      let sum = 0;
      for (const dept of departments) {
        const kwh = m.get(dept) ?? 0;
        sum += kwh;
        rows.push({
          month,
          department: dept,
          kwh: round3(kwh),
          cost: round2(kwh * tenant.tariffPerKwh),
        });
      }
      monthTotals.push({ month, kwh: round3(sum), cost: round2(sum * tenant.tariffPerKwh) });
    }
    return {
      currency: tenant.currency,
      tariffPerKwh: tenant.tariffPerKwh,
      months: keys,
      departments,
      rows,
      totals: monthTotals,
    };
  }
}

function dayKeyOf(ms: number, timeZone: string): string {
  const p = zonedDateParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;
