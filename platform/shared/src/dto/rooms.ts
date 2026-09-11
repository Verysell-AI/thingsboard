import { z } from 'zod';
import { RoomKindSchema } from '../dataset/schema.js';
import { IdSchema } from './common.js';

export const BOOKING_ATTENDANCE = ['FULL', 'LATE', 'GHOST'] as const;
export const BookingAttendanceSchema = z.enum(BOOKING_ATTENDANCE);
export type BookingAttendance = z.infer<typeof BookingAttendanceSchema>;

export const BOOKING_STATUSES = ['ACTIVE', 'RELEASED', 'DONE', 'CANCELLED'] as const;
export const BookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  roomCode: z.string(),
  /** ISO timestamps. */
  start: z.string(),
  end: z.string(),
  organiser: z
    .object({ id: IdSchema, name: z.string(), department: z.string(), email: z.string() })
    .nullable(),
  title: z.string(),
  attendance: BookingAttendanceSchema,
  status: BookingStatusSchema,
  createdAt: z.string(),
});
export type Booking = z.infer<typeof BookingSchema>;

export const CreateBookingSchema = z.object({
  roomId: IdSchema,
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  title: z.string().min(1).max(200),
  organiserId: IdSchema.optional(),
  /** Simulated attendance; only honoured for tenants in demo mode. */
  attendance: BookingAttendanceSchema.optional(),
});
export type CreateBooking = z.infer<typeof CreateBookingSchema>;

/** Body of POST /bookings/:id/extend (room panel "Extend"). */
export const ExtendBookingSchema = z.object({
  minutes: z.number().int().min(5).max(240).default(30),
});
export type ExtendBooking = z.infer<typeof ExtendBookingSchema>;

export const BookingsQuerySchema = z.object({
  roomId: IdSchema.optional(),
  /** ISO or ms; defaults to the start of the current business day. */
  from: z.string().optional(),
  to: z.string().optional(),
  status: BookingStatusSchema.optional(),
});
export type BookingsQuery = z.infer<typeof BookingsQuerySchema>;

export const BookingsResponseSchema = z.object({ items: z.array(BookingSchema) });
export type BookingsResponse = z.infer<typeof BookingsResponseSchema>;

/**
 * FREE: nobody there and no active booking. BUSY: someone is there (sensor or laptops).
 * BOOKED: an active booking has started but nobody has shown up (yet).
 */
export const ROOM_STATUSES = ['FREE', 'BUSY', 'BOOKED'] as const;
export const RoomStatusSchema = z.enum(ROOM_STATUSES);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export function deriveRoomStatus(input: {
  occupied: boolean;
  currentBooking: boolean;
}): RoomStatus {
  if (input.occupied) return 'BUSY';
  return input.currentBooking ? 'BOOKED' : 'FREE';
}

export const RoomViewSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  floor: z.number().int().nullable(),
  zone: z.string().nullable(),
  kind: RoomKindSchema.nullable(),
  capacity: z.number().int().nullable(),
  critical: z.boolean(),
  status: RoomStatusSchema,
  occupied: z.boolean(),
  /** People seen by the occupancy sensor (0 when the room has none). */
  peopleCount: z.number().int().min(0),
  laptopsOnline: z.number().int().min(0),
  lightsOn: z.boolean(),
  acOn: z.boolean(),
  powerW: z.number().nullable(),
  /** Room-meter energy since local midnight and its cost at the tenant tariff. */
  energyTodayKwh: z.number().nullable(),
  costToday: z.number().nullable(),
  /** Minutes the room has been empty while lights or AC were on (Phase 2 waste badge). */
  wastingSinceMinutes: z.number().int().min(0).nullable(),
  wastedKwhToday: z.number().nullable(),
  currentBooking: BookingSchema.nullable(),
  nextBooking: BookingSchema.nullable(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;

export const RoomsQuerySchema = z.object({
  floor: z.coerce.number().int().optional(),
  kind: RoomKindSchema.optional(),
});

export const RoomsResponseSchema = z.object({ items: z.array(RoomViewSchema) });
export type RoomsResponse = z.infer<typeof RoomsResponseSchema>;

export const RoomDeviceSchema = z.object({
  assetId: IdSchema,
  code: z.string(),
  type: z.string(),
  name: z.string(),
  appliance: z.string().nullable(),
});

export const RoomDetailSchema = RoomViewSchema.extend({
  bookingsToday: z.array(BookingSchema),
  devices: z.array(RoomDeviceSchema),
});
export type RoomDetail = z.infer<typeof RoomDetailSchema>;

/** Internal: bookings active right now (business clock) for the simulator's occupancy. */
export const BookingsNowResponseSchema = z.object({
  tenantKey: z.string(),
  now: z.number().int(),
  items: z.array(
    z.object({
      id: IdSchema,
      roomCode: z.string(),
      start: z.number().int(),
      end: z.number().int(),
      attendance: BookingAttendanceSchema,
      /** Employee code of the organiser, when known. */
      organiserCode: z.string().nullable(),
      /** Expected head count for a FULL/LATE meeting. */
      attendees: z.number().int().min(0),
    }),
  ),
});
export type BookingsNowResponse = z.infer<typeof BookingsNowResponseSchema>;

/** Minutes after the start when a LATE meeting's people arrive (context §5.5). */
export const LATE_ARRIVAL_MINUTES = 12;
