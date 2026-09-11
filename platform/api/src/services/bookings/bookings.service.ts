import { and, asc, eq, gt, inArray, lt, lte, ne, type SQL } from 'drizzle-orm';
import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import type {
  Booking,
  BookingsNowResponse,
  BookingsQuery,
  CreateBooking,
} from '@platform/shared/dto';
import type { Db, DbTx } from '../../db/index.js';
import {
  bookings,
  employees,
  locations,
  users,
  type BookingRow,
  type EmployeeRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { getContext } from '../../lib/context.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClockService } from '../clock/clock.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

/** Length of the booking the console's "ghost meeting" scenario creates. */
export const GHOST_MEETING_MINUTES = 45;

type OrganiserRef = Pick<EmployeeRow, 'id' | 'name' | 'department' | 'email' | 'code'>;

export interface BookingWithRefs {
  booking: BookingRow;
  roomCode: string;
  organiser: OrganiserRef | null;
}

export function toBookingDto(b: BookingWithRefs): Booking {
  return {
    id: b.booking.id,
    roomId: b.booking.roomId,
    roomCode: b.roomCode,
    start: b.booking.start.toISOString(),
    end: b.booking.end.toISOString(),
    organiser: b.organiser
      ? {
          id: b.organiser.id,
          name: b.organiser.name,
          department: b.organiser.department,
          email: b.organiser.email,
        }
      : null,
    title: b.booking.title,
    attendance: b.booking.attendance,
    status: b.booking.status,
    createdAt: b.booking.createdAt.toISOString(),
  };
}

/** True when [aStart, aEnd) and [bStart, bEnd) share any instant. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Expected head count of a booking: 0 for ghosts, otherwise 2 + a stable hash, capped by capacity. */
export function expectedAttendees(
  bookingId: string,
  attendance: BookingRow['attendance'],
  capacity: number | null,
): number {
  if (attendance === 'GHOST') return 0;
  let h = 0;
  for (let i = 0; i < bookingId.length; i++) h = (h * 31 + bookingId.charCodeAt(i)) >>> 0;
  const n = 2 + (h % 5);
  return capacity ? Math.min(capacity, n) : n;
}

/** Start of the local day containing `ms`, in the zone. */
export function startOfDay(ms: number, timeZone: string): number {
  const p = zonedDateParts(ms, timeZone);
  return zonedTimeToEpoch({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
}

export class BookingsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly timeZone: string,
    private notifications: NotificationsService | null = null,
  ) {}

  /** Notifications exist after bookings in the container; wired once both are built. */
  setNotifications(notifications: NotificationsService): void {
    this.notifications = notifications;
  }

  private select(tx: DbTx) {
    return tx
      .select({ booking: bookings, roomCode: locations.code, organiser: employees })
      .from(bookings)
      .innerJoin(locations, eq(locations.id, bookings.roomId))
      .leftJoin(employees, eq(employees.id, bookings.organiserId));
  }

  /** Bookings intersecting [from, to) for the given rooms (all when omitted), oldest first. */
  async inRange(
    tx: DbTx,
    from: number,
    to: number,
    filter: { roomIds?: string[]; status?: BookingRow['status'][] } = {},
  ): Promise<BookingWithRefs[]> {
    const conds: SQL[] = [lt(bookings.start, new Date(to)), gt(bookings.end, new Date(from))];
    if (filter.roomIds) {
      if (filter.roomIds.length === 0) return [];
      conds.push(inArray(bookings.roomId, filter.roomIds));
    }
    if (filter.status) conds.push(inArray(bookings.status, filter.status));
    return this.select(tx)
      .where(and(...conds))
      .orderBy(asc(bookings.start));
  }

  async list(tenant: { id: string; key: string }, query: BookingsQuery): Promise<Booking[]> {
    const now = await this.clock.now(tenant.key);
    const from = parseTime(query.from) ?? startOfDay(now, this.timeZone);
    const to = parseTime(query.to) ?? from + 24 * 3_600_000;
    if (to <= from) throw badRequest('to must be after from');
    return withTenant(this.db, tenant.id, async (tx) => {
      const rows = await this.inRange(tx, from, to, {
        ...(query.roomId ? { roomIds: [query.roomId] } : {}),
        ...(query.status ? { status: [query.status] } : {}),
      });
      return rows.map(toBookingDto);
    });
  }

  async byId(tenantId: string, id: string): Promise<Booking> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await this.select(tx).where(eq(bookings.id, id)).limit(1);
      if (!rows[0]) throw notFound('Booking not found');
      return toBookingDto(rows[0]);
    });
  }

  async create(
    tenant: { id: string; key: string; demoMode: boolean },
    input: CreateBooking,
  ): Promise<Booking> {
    const start = Date.parse(input.start);
    const end = Date.parse(input.end);
    if (!(end > start)) throw badRequest('end must be after start');
    if (end - start > 12 * 3_600_000) throw badRequest('a booking cannot exceed 12 hours');
    const ctx = getContext();
    return withTenant(this.db, tenant.id, async (tx) => {
      const room = (
        await tx.select().from(locations).where(eq(locations.id, input.roomId)).limit(1)
      )[0];
      if (!room || room.type !== 'ROOM') throw notFound('Room not found');
      if (room.kind !== 'meeting') throw badRequest('Only meeting rooms can be booked');
      const clashing = await this.inRange(tx, start, end, {
        roomIds: [room.id],
        status: ['ACTIVE'],
      });
      if (clashing.length) throw conflict('The room is already booked for that time');

      let organiserId = input.organiserId ?? null;
      if (!organiserId && ctx.userId) {
        const u = (
          await tx
            .select({ employeeId: users.employeeId })
            .from(users)
            .where(eq(users.id, ctx.userId))
            .limit(1)
        )[0];
        organiserId = u?.employeeId ?? null;
      }
      if (organiserId) {
        const e = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.id, organiserId))
          .limit(1);
        if (!e[0]) throw badRequest('Unknown organiser');
      }
      const [row] = await tx
        .insert(bookings)
        .values({
          tenantId: tenant.id,
          roomId: room.id,
          start: new Date(start),
          end: new Date(end),
          organiserId,
          title: input.title,
          attendance: tenant.demoMode && input.attendance ? input.attendance : 'FULL',
          status: 'ACTIVE',
        })
        .returning();
      await this.audit.record(tx, {
        action: 'booking.create',
        entityType: 'booking',
        entityId: row!.id,
        after: { room: room.code, start: input.start, end: input.end, title: input.title },
      });
      const full = await this.select(tx).where(eq(bookings.id, row!.id)).limit(1);
      return toBookingDto(full[0]!);
    });
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: 'CANCELLED' | 'RELEASED' | 'DONE',
    reason?: string,
  ): Promise<Booking> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await this.select(tx).where(eq(bookings.id, id)).limit(1);
      const found = rows[0];
      if (!found) throw notFound('Booking not found');
      if (found.booking.status !== 'ACTIVE')
        throw conflict(`Booking is already ${found.booking.status.toLowerCase()}`);
      const [updated] = await tx
        .update(bookings)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(bookings.id, id), ne(bookings.status, status)))
        .returning();
      await this.audit.record(tx, {
        action: `booking.${status.toLowerCase()}`,
        entityType: 'booking',
        entityId: id,
        before: { status: found.booking.status },
        after: { status, reason: reason ?? null, room: found.roomCode },
      });
      return toBookingDto({ ...found, booking: updated! });
    });
  }

  /**
   * Releases a booking nobody showed up for (automation or the room panel) and tells the organiser
   * and operations. Idempotent for bookings that are no longer active (409 from setStatus).
   */
  async release(tenant: { id: string; key: string }, id: string, reason: string): Promise<Booking> {
    const booking = await this.setStatus(tenant.id, id, 'RELEASED', reason);
    if (this.notifications) {
      const organiserUsers = booking.organiser
        ? await withTenant(this.db, tenant.id, (tx) =>
            tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.employeeId, booking.organiser!.id)),
          )
        : [];
      await this.notifications.create({
        tenantId: tenant.id,
        tenantKey: tenant.key,
        userIds: organiserUsers.map((u) => u.id),
        roles: ['TENANT_ADMIN', 'OPS_MANAGER'],
        kind: 'booking.released',
        title: `Booking released: ${booking.roomCode}`,
        body: `"${booking.title}" in ${booking.roomCode} was released (${reason}).`,
        subject: `booking:${booking.id}`,
      });
    }
    return booking;
  }

  /** Extends an active booking; refused when the room is taken right after it. */
  async extend(tenantId: string, id: string, minutes: number): Promise<Booking> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await this.select(tx).where(eq(bookings.id, id)).limit(1);
      const found = rows[0];
      if (!found) throw notFound('Booking not found');
      if (found.booking.status !== 'ACTIVE') throw conflict('Only active bookings can be extended');
      const newEnd = found.booking.end.getTime() + minutes * 60_000;
      const clashing = await this.inRange(tx, found.booking.end.getTime(), newEnd, {
        roomIds: [found.booking.roomId],
        status: ['ACTIVE'],
      });
      if (clashing.some((c) => c.booking.id !== id))
        throw conflict('The room is booked right after this meeting');
      const [updated] = await tx
        .update(bookings)
        .set({ end: new Date(newEnd), updatedAt: new Date() })
        .where(eq(bookings.id, id))
        .returning();
      await this.audit.record(tx, {
        action: 'booking.extend',
        entityType: 'booking',
        entityId: id,
        before: { end: found.booking.end.toISOString() },
        after: { end: new Date(newEnd).toISOString(), minutes },
      });
      return toBookingDto({ ...found, booking: updated! });
    });
  }

  /** Console scenario: a booking starting now that nobody will attend, in the given meeting room. */
  async createGhostMeeting(
    tenant: { id: string; key: string; demoMode: boolean },
    roomCode: string,
  ): Promise<Booking> {
    const now = await this.clock.now(tenant.key);
    const roomId = await withTenant(this.db, tenant.id, async (tx) => {
      const r = (
        await tx
          .select({ id: locations.id, kind: locations.kind })
          .from(locations)
          .where(and(eq(locations.type, 'ROOM'), eq(locations.code, roomCode)))
          .limit(1)
      )[0];
      if (!r) throw notFound(`Room ${roomCode} not found`);
      if (r.kind !== 'meeting') throw badRequest(`${roomCode} is not a meeting room`);
      return r.id;
    });
    const start = Math.floor(now / 60_000) * 60_000;
    return this.create(tenant, {
      roomId,
      start: new Date(start).toISOString(),
      end: new Date(start + GHOST_MEETING_MINUTES * 60_000).toISOString(),
      title: 'Ghost meeting',
      attendance: 'GHOST',
    });
  }

  /** Active bookings running right now, for the simulator's occupancy (business clock). */
  async activeNow(tenant: { id: string; key: string }): Promise<BookingsNowResponse> {
    const now = await this.clock.now(tenant.key);
    return withTenant(this.db, tenant.id, async (tx) => {
      const rows = await tx
        .select({
          booking: bookings,
          roomCode: locations.code,
          capacity: locations.capacity,
          organiserCode: employees.code,
        })
        .from(bookings)
        .innerJoin(locations, eq(locations.id, bookings.roomId))
        .leftJoin(employees, eq(employees.id, bookings.organiserId))
        .where(
          and(
            eq(bookings.status, 'ACTIVE'),
            lte(bookings.start, new Date(now)),
            gt(bookings.end, new Date(now)),
          ),
        );
      return {
        tenantKey: tenant.key,
        now,
        items: rows.map((r) => ({
          id: r.booking.id,
          roomCode: r.roomCode,
          start: r.booking.start.getTime(),
          end: r.booking.end.getTime(),
          attendance: r.booking.attendance,
          organiserCode: r.organiserCode,
          attendees: expectedAttendees(r.booking.id, r.booking.attendance, r.capacity),
        })),
      };
    });
  }
}

function parseTime(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && v.trim() !== '') return n;
  const d = Date.parse(v);
  if (Number.isNaN(d)) throw badRequest(`invalid time ${v}`);
  return d;
}
