import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';
import { employees } from './employees.js';
import { locations } from './locations.js';

export const attendanceEnum = pgEnum('booking_attendance', ['FULL', 'LATE', 'GHOST']);
export const bookingStatusEnum = pgEnum('booking_status', [
  'ACTIVE',
  'RELEASED',
  'DONE',
  'CANCELLED',
]);

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    tenantId: tenantId(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    start: timestamp('start', { withTimezone: true }).notNull(),
    end: timestamp('end', { withTimezone: true }).notNull(),
    organiserId: uuid('organiser_id').references(() => employees.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    attendance: attendanceEnum('attendance').notNull().default('FULL'),
    status: bookingStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('bookings_room_start_idx').on(t.roomId, t.start), tenantPolicy('bookings')],
).enableRLS();

export type BookingRow = typeof bookings.$inferSelect;
