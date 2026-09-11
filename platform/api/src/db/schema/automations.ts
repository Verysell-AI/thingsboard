import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';

export const automations = pgTable(
  'automations',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('automations_tenant_key_idx').on(t.tenantId, t.key),
    tenantPolicy('automations'),
  ],
).enableRLS();

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    trigger: text('trigger').notNull().default('schedule'),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
  },
  () => [tenantPolicy('automation_runs')],
).enableRLS();

export type AutomationRow = typeof automations.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;
