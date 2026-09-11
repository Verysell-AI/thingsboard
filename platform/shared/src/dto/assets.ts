import { z } from 'zod';
import { RpcRequestSchema } from '../contracts/rpc.js';
import { IdSchema, PageQuerySchema, pageOf } from './common.js';

export const ASSET_STATUSES = ['ACTIVE', 'IN_STOCK', 'IN_REPAIR', 'RETIRED', 'MISSING'] as const;
export const AssetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const AssetLocationSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  type: z.string(),
  floor: z.number().int().nullable(),
});
export type AssetLocation = z.infer<typeof AssetLocationSchema>;

export const AssetCustodianSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  department: z.string(),
  email: z.string(),
});
export type AssetCustodian = z.infer<typeof AssetCustodianSchema>;

/** One row of the asset register (BRD asset master + live/device link). */
export const AssetSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  /** Broad class: device, laptop, furniture, ... */
  class: z.string(),
  /** Fine type: light, ac, projector, monitor, laptop, ... */
  type: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serial: z.string().nullable(),
  category: z.string().nullable(),
  location: AssetLocationSchema.nullable(),
  custodian: AssetCustodianSchema.nullable(),
  /** ISO date (YYYY-MM-DD). */
  purchaseDate: z.string().nullable(),
  purchaseCost: z.number().nullable(),
  usefulLifeYears: z.number().int().nullable(),
  warrantyEnd: z.string().nullable(),
  status: AssetStatusSchema,
  tbDeviceId: z.string().nullable(),
  /** ThingsBoard device profile (light, ac, plug, laptop, ...) when the asset has a device. */
  deviceType: z.string().nullable(),
  appliance: z.string().nullable(),
  sweepable: z.boolean().nullable(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  misplacedRoom: z.object({ id: IdSchema, code: z.string() }).nullable(),
  /** Straight-line book value today, in the tenant currency; null without cost or life. */
  bookValue: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetsQuerySchema = PageQuerySchema.extend({
  /** Matches code, name, serial, brand, model and custodian name (case-insensitive). */
  search: z.string().optional(),
  class: z.string().optional(),
  type: z.string().optional(),
  deviceType: z.string().optional(),
  floor: z.coerce.number().int().optional(),
  /** Room code. */
  room: z.string().optional(),
  custodianId: IdSchema.optional(),
  status: AssetStatusSchema.optional(),
  /** Only assets flagged misplaced or MISSING. */
  exceptions: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  sort: z.enum(['code', 'name', 'type', 'location', 'purchaseDate', 'warrantyEnd']).default('code'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type AssetsQuery = z.infer<typeof AssetsQuerySchema>;

export const AssetsResponseSchema = pageOf(AssetSchema);
export type AssetsResponse = z.infer<typeof AssetsResponseSchema>;

/** Distinct values available for the register filters. */
export const AssetFacetsSchema = z.object({
  classes: z.array(z.string()),
  types: z.array(z.string()),
  floors: z.array(z.number().int()),
  rooms: z.array(
    z.object({ code: z.string(), name: z.string(), floor: z.number().int().nullable() }),
  ),
  custodians: z.array(z.object({ id: IdSchema, name: z.string() })),
});
export type AssetFacets = z.infer<typeof AssetFacetsSchema>;

export const CommandSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
  source: z.enum(['USER', 'AUTOMATION', 'SYSTEM']),
  actorUserId: IdSchema.nullable(),
  automationRunId: IdSchema.nullable(),
  result: z.string(),
  error: z.string().nullable(),
  sentAt: z.string(),
});
export type Command = z.infer<typeof CommandSchema>;

/** Body of POST /assets/:id/commands: the RPC the device understands (contracts/rpc). */
export const CommandRequestSchema = RpcRequestSchema;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

export const CustodyEntrySchema = z.object({
  ts: z.string(),
  actor: z.string().nullable(),
  from: AssetCustodianSchema.pick({ id: true, name: true }).nullable(),
  to: AssetCustodianSchema.pick({ id: true, name: true }).nullable(),
});
export type CustodyEntry = z.infer<typeof CustodyEntrySchema>;

export const AuditEntrySchema = z.object({
  id: IdSchema,
  ts: z.string(),
  actorType: z.string(),
  actorLabel: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AssetDetailSchema = AssetSchema.extend({
  commands: z.array(CommandSchema),
  custody: z.array(CustodyEntrySchema),
  audit: z.array(AuditEntrySchema),
  /** Server attributes mirrored from the dataset/device registration (nominal power, thresholds). */
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AssetDetail = z.infer<typeof AssetDetailSchema>;

export const UpdateAssetSchema = z
  .object({
    name: z.string().min(1).max(200),
    brand: z.string().max(100).nullable(),
    model: z.string().max(100).nullable(),
    serial: z.string().max(100).nullable(),
    category: z.string().max(100).nullable(),
    status: AssetStatusSchema,
    locationId: IdSchema.nullable(),
    custodianEmployeeId: IdSchema.nullable(),
    purchaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    purchaseCost: z.number().min(0).nullable(),
    usefulLifeYears: z.number().int().min(1).max(50).nullable(),
    warrantyEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .partial();
export type UpdateAsset = z.infer<typeof UpdateAssetSchema>;

export const HISTORY_AGGS = ['AVG', 'SUM', 'MAX', 'MIN', 'NONE'] as const;

/** Query for GET /assets/:id/history (ThingsBoard proxy). Defaults: last 24 h, 15-minute AVG. */
export const HistoryQuerySchema = z.object({
  /** Comma-separated telemetry keys. */
  keys: z.string().min(1),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  /** Aggregation bucket in ms. */
  interval: z.coerce.number().int().min(60_000).optional(),
  agg: z.enum(HISTORY_AGGS).default('AVG'),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const SeriesPointSchema = z.object({ ts: z.number().int(), value: z.number() });
export type SeriesPoint = z.infer<typeof SeriesPointSchema>;

export const HistoryResponseSchema = z.object({
  deviceCode: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  interval: z.number().int(),
  agg: z.enum(HISTORY_AGGS),
  series: z.record(z.string(), z.array(SeriesPointSchema)),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

/** Straight-line depreciation: book value today from cost, purchase date and useful life. */
export function bookValueOf(
  purchaseCost: number | null,
  purchaseDate: string | null,
  usefulLifeYears: number | null,
  nowMs: number,
): number | null {
  if (purchaseCost === null || !purchaseDate || !usefulLifeYears) return null;
  const bought = Date.parse(purchaseDate);
  if (Number.isNaN(bought)) return null;
  const ageYears = Math.max(0, (nowMs - bought) / (365.25 * 86_400_000));
  const remaining = Math.max(0, 1 - ageYears / usefulLifeYears);
  return Math.round(purchaseCost * remaining * 100) / 100;
}
