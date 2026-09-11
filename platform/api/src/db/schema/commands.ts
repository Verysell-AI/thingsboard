import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { automationRuns } from './automations.js';
import { id, tenantId, tenantPolicy } from './common.js';
import { users } from './users.js';

export const commandSourceEnum = pgEnum('command_source', ['USER', 'AUTOMATION', 'SYSTEM']);

export const commands = pgTable(
  'commands',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    source: commandSourceEnum('source').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    automationRunId: uuid('automation_run_id').references(() => automationRuns.id, {
      onDelete: 'set null',
    }),
    result: text('result').notNull().default('SENT'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('commands_asset_sent_idx').on(t.assetId, t.sentAt), tenantPolicy('commands')],
).enableRLS();

export type CommandRow = typeof commands.$inferSelect;
