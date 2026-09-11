import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Platform operators: they own tenants, not data inside a tenant. Like `tenants`, this table is
 * outside row-level security — it has no tenant to scope to and is only reached by /admin routes.
 */
export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformAdminRow = typeof platformAdmins.$inferSelect;
export type NewPlatformAdmin = typeof platformAdmins.$inferInsert;
