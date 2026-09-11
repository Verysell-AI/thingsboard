import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';

export const maintenanceStatusEnum = pgEnum('maintenance_status', [
  'OPEN',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
]);

export const maintenanceTasks = pgTable(
  'maintenance_tasks',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    cause: text('cause'),
    status: maintenanceStatusEnum('status').notNull().default('OPEN'),
    createdFromAlarmId: text('created_from_alarm_id'),
    notes: text('notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [tenantPolicy('maintenance_tasks')],
).enableRLS();

export type MaintenanceTaskRow = typeof maintenanceTasks.$inferSelect;
