import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, tenantId, tenantPolicy } from './common.js';

export const reports = pgTable(
  'reports',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    period: text('period').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    pdfPath: text('pdf_path'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  },
  () => [tenantPolicy('reports')],
).enableRLS();

export type ReportRow = typeof reports.$inferSelect;
