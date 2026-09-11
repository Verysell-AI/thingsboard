import { z } from 'zod';
import { GeometrySchema, RoomKindSchema } from '../dataset/schema.js';
import { IdSchema } from './common.js';

export const LOCATION_TYPES = ['SITE', 'BUILDING', 'FLOOR', 'ROOM', 'ZONE'] as const;
export const LocationTypeSchema = z.enum(LOCATION_TYPES);
export type LocationType = z.infer<typeof LocationTypeSchema>;

export const LocationSchema = z.object({
  id: IdSchema,
  type: LocationTypeSchema,
  code: z.string(),
  name: z.string(),
  parentId: IdSchema.nullable(),
  /** Floor number for FLOOR, ROOM and ZONE rows. */
  floor: z.number().int().nullable(),
  /** Zone code for rooms. */
  zone: z.string().nullable(),
  kind: RoomKindSchema.nullable(),
  capacity: z.number().int().nullable(),
  critical: z.boolean(),
  geometry: GeometrySchema.nullable(),
  tbAssetId: z.string().nullable(),
  /** Wi-Fi access point id laptops report while in this zone (ZONE rows only). */
  accessPoint: z.string().nullable().default(null),
});
export type Location = z.infer<typeof LocationSchema>;

export const DeskSummarySchema = z.object({
  code: z.string(),
  room: z.string(),
  zone: z.string(),
  x: z.number(),
  y: z.number(),
  employeeId: IdSchema.nullable(),
});
export type DeskSummary = z.infer<typeof DeskSummarySchema>;

export const LocationsQuerySchema = z.object({
  type: LocationTypeSchema.optional(),
  floor: z.coerce.number().int().optional(),
});

export const LocationsResponseSchema = z.object({
  items: z.array(LocationSchema),
});
export type LocationsResponse = z.infer<typeof LocationsResponseSchema>;

/** Everything the floor plan needs for one floor. */
export const FloorPlanSchema = z.object({
  floor: LocationSchema,
  rooms: z.array(LocationSchema),
  zones: z.array(LocationSchema),
  desks: z.array(DeskSummarySchema),
  devices: z.array(
    z.object({
      code: z.string(),
      type: z.string(),
      name: z.string(),
      room: z.string().nullable(),
      /** Plug appliance (projector, fridge, coffee_machine, monitor, heater) when known. */
      appliance: z.string().nullable().default(null),
      x: z.number().nullable(),
      y: z.number().nullable(),
      assetId: IdSchema.nullable(),
    }),
  ),
});
export type FloorPlan = z.infer<typeof FloorPlanSchema>;
