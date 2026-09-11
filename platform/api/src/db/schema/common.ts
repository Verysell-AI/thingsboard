import { sql } from 'drizzle-orm';
import { pgPolicy, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/** Row-level security policy applied to every tenant-scoped table. */
export function tenantPolicy(table: string) {
  return pgPolicy(`${table}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    to: 'app',
    using: sql`tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`,
  });
}

export const id = () => uuid('id').primaryKey().defaultRandom();
export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
