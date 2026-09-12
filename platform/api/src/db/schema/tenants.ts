import { boolean, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** A logo or favicon: SVG markup for `image/svg+xml`, base64 for raster types. */
export interface TenantBrandAsset {
  mime: string;
  content: string;
}

/** Brand stored per tenant; assets inline so no file storage is needed. */
export interface TenantBrand {
  name: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  logo: TenantBrandAsset;
  favicon: TenantBrandAsset;
  fontFamily: string;
  loginTagline: string | null;
  /** ThingsBoard dashboard ids by key (energy-overview, floor-drilldown, ...). */
  dashboards: Record<string, string>;
}

/** Tenants are resolved by hostname before any tenant context exists, so this table has no RLS. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  hostname: text('hostname').notNull().unique(),
  tbTenantId: text('tb_tenant_id'),
  brand: jsonb('brand').$type<TenantBrand>().notNull(),
  locale: text('locale').notNull().default('en'),
  tariffPerKwh: numeric('tariff_per_kwh', { precision: 10, scale: 4 }).notNull().default('0.44'),
  currency: text('currency').notNull().default('AED'),
  demoMode: boolean('demo_mode').notNull().default(false),
  /** The simulator drives this tenant's devices (see GET /internal/tenants/simulated). */
  simulated: boolean('simulated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
