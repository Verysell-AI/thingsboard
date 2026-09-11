import { date, integer, numeric, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { tenantId, tenantPolicy } from './common.js';
import { locations } from './locations.js';

export const roomDailyStats = pgTable(
  'room_daily_stats',
  {
    tenantId: tenantId(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    occupiedMinutes: integer('occupied_minutes').notNull().default(0),
    bookedMinutes: integer('booked_minutes').notNull().default(0),
    ghostCount: integer('ghost_count').notNull().default(0),
    kwh: numeric('kwh', { precision: 12, scale: 4 }).notNull().default('0'),
    wastedKwh: numeric('wasted_kwh', { precision: 12, scale: 4 }).notNull().default('0'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.roomId, t.date] }),
    tenantPolicy('room_daily_stats'),
  ],
).enableRLS();

export const deviceNightlyStats = pgTable(
  'device_nightly_stats',
  {
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    avgNightPowerW: numeric('avg_night_power_w', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    hoursAbove5w: numeric('hours_above_5w', { precision: 6, scale: 2 }).notNull().default('0'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.assetId, t.date] }),
    tenantPolicy('device_nightly_stats'),
  ],
).enableRLS();

/** Occupied and booked minutes per room and hour of the business day; feeds the utilisation heatmap. */
export const roomHourlyStats = pgTable(
  'room_hourly_stats',
  {
    tenantId: tenantId(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    hour: integer('hour').notNull(),
    occupiedMinutes: integer('occupied_minutes').notNull().default(0),
    bookedMinutes: integer('booked_minutes').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.roomId, t.date, t.hour] }),
    tenantPolicy('room_hourly_stats'),
  ],
).enableRLS();

export type RoomDailyStatRow = typeof roomDailyStats.$inferSelect;
export type RoomHourlyStatRow = typeof roomHourlyStats.$inferSelect;
export type DeviceNightlyStatRow = typeof deviceNightlyStats.$inferSelect;
