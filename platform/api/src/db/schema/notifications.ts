import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy } from './common.js';
import { users } from './users.js';

export interface NotificationAction {
  key: string;
  label: string;
}

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    actions: jsonb('actions').$type<NotificationAction[]>().notNull().default([]),
    /** Related entity (asset code, room code, alarm id) for deduplication and deep links. */
    subject: text('subject'),
    readAt: timestamp('read_at', { withTimezone: true }),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    actedKey: text('acted_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    tenantPolicy('notifications'),
  ],
).enableRLS();

export type NotificationRow = typeof notifications.$inferSelect;
