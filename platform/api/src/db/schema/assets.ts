import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';
import { employees } from './employees.js';
import { locations } from './locations.js';

export const assetStatusEnum = pgEnum('asset_status', [
  'ACTIVE',
  'IN_STOCK',
  'IN_REPAIR',
  'RETIRED',
  'MISSING',
]);

export interface AssetMeta {
  x?: number | null;
  y?: number | null;
  nominalPowerW?: number;
  nominalCurrentA?: number;
  appliance?: string;
  sweepable?: boolean;
  nightBaselineW?: number;
  accessToken?: string;
  [key: string]: unknown;
}

export const assets = pgTable(
  'assets',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Broad class: device, laptop, furniture, ... */
    class: text('class').notNull(),
    /** Fine type: light, ac, plug, monitor, projector, ... */
    type: text('type').notNull(),
    brand: text('brand'),
    model: text('model'),
    serial: text('serial'),
    category: text('category'),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    custodianEmployeeId: uuid('custodian_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    purchaseDate: date('purchase_date'),
    purchaseCost: numeric('purchase_cost', { precision: 12, scale: 2 }),
    usefulLifeYears: integer('useful_life_years'),
    warrantyEnd: date('warranty_end'),
    status: assetStatusEnum('status').notNull().default('ACTIVE'),
    tbDeviceId: text('tb_device_id'),
    /** ThingsBoard device profile name when the asset has a device. */
    deviceType: text('device_type'),
    meta: jsonb('meta').$type<AssetMeta>().notNull().default({}),
    misplacedRoomId: uuid('misplaced_room_id').references(() => locations.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assets_tenant_code_idx').on(t.tenantId, t.code),
    index('assets_tb_device_idx').on(t.tbDeviceId),
    index('assets_location_idx').on(t.locationId),
    tenantPolicy('assets'),
  ],
).enableRLS();

export type AssetRow = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
