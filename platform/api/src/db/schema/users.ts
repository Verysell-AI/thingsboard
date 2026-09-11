import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';
import { employees } from './employees.js';

export const roleEnum = pgEnum('role', [
  'TENANT_ADMIN',
  'OPS_MANAGER',
  'FIELD_OPERATOR',
  'FINANCE',
  'VIEWER',
]);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    displayName: text('display_name').notNull(),
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    /** Bumped on refresh to invalidate older refresh tokens. */
    refreshTokenVersion: text('refresh_token_version').notNull().default('0'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_tenant_email_idx').on(t.tenantId, t.email), tenantPolicy('users')],
).enableRLS();

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
