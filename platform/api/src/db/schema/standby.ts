import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { createdAt, id, tenantId, tenantPolicy } from './common.js';
import { users } from './users.js';

/** A device whose night-time standby draw operations has reviewed and accepted. */
export const standbyAcknowledgements = pgTable(
  'standby_acknowledgements',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('standby_ack_tenant_asset_idx').on(t.tenantId, t.assetId),
    tenantPolicy('standby_acknowledgements'),
  ],
).enableRLS();

export type StandbyAcknowledgementRow = typeof standbyAcknowledgements.$inferSelect;
