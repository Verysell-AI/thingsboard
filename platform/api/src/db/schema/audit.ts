import { index, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, tenantId, tenantPolicy } from './common.js';

export const actorTypeEnum = pgEnum('actor_type', ['USER', 'SYSTEM', 'AUTOMATION', 'ANONYMOUS']);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: tenantId(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_log_tenant_ts_idx').on(t.tenantId, t.ts),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    tenantPolicy('audit_log'),
  ],
).enableRLS();

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
