import { pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy } from './common.js';

export const holdScopeEnum = pgEnum('hold_scope', ['ZONE', 'FLOOR', 'ROOM']);

/** A hold keeps a scope powered until `until` regardless of automations (late worker, event tonight). */
export const holds = pgTable(
  'holds',
  {
    id: id(),
    tenantId: tenantId(),
    scopeType: holdScopeEnum('scope_type').notNull(),
    /** Location code (zone, floor number or room code). */
    scopeId: text('scope_id').notNull(),
    until: timestamp('until', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  () => [tenantPolicy('holds')],
).enableRLS();

export type HoldRow = typeof holds.$inferSelect;
