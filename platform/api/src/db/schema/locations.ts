import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, tenantPolicy, updatedAt } from './common.js';

export const locationTypeEnum = pgEnum('location_type', [
  'SITE',
  'BUILDING',
  'FLOOR',
  'ROOM',
  'ZONE',
]);

export interface DeskGeometry {
  code: string;
  zone: string;
  x: number;
  y: number;
  employeeId: string | null;
}

/**
 * Geometry per location type: rooms carry the floor-plan rectangle and (open plan) their desks;
 * zones carry the Wi-Fi access point id laptops report.
 */
export interface LocationGeometry {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  desks?: DeskGeometry[];
  accessPoint?: string;
}

export const locations = pgTable(
  'locations',
  {
    id: id(),
    tenantId: tenantId(),
    type: locationTypeEnum('type').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => locations.id, {
      onDelete: 'cascade',
    }),
    tbAssetId: text('tb_asset_id'),
    floor: integer('floor'),
    zone: text('zone'),
    kind: text('kind'),
    capacity: integer('capacity'),
    critical: boolean('critical').notNull().default(false),
    geometry: jsonb('geometry').$type<LocationGeometry>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('locations_tenant_code_idx').on(t.tenantId, t.code),
    index('locations_tb_asset_idx').on(t.tbAssetId),
    tenantPolicy('locations'),
  ],
).enableRLS();

export type LocationRow = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
