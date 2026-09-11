import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';
import { locations } from './locations.js';

export const employees = pgTable(
  'employees',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    department: text('department').notNull(),
    deskRoomId: uuid('desk_room_id').references(() => locations.id, { onDelete: 'set null' }),
    /** Desk code inside the open-plan room, e.g. D-1.O-03. */
    deskCode: text('desk_code'),
    zone: text('zone'),
    persona: text('persona'),
    email: text('email').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('employees_tenant_code_idx').on(t.tenantId, t.code),
    tenantPolicy('employees'),
  ],
).enableRLS();

export type EmployeeRow = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
