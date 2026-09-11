import { z } from 'zod';
import { IdSchema, PageQuerySchema, pageOf } from './common.js';

export const MAINTENANCE_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const MaintenanceStatusSchema = z.enum(MAINTENANCE_STATUSES);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;

export const MaintenanceTaskSchema = z.object({
  id: IdSchema,
  asset: z.object({
    id: IdSchema,
    code: z.string(),
    name: z.string(),
    type: z.string(),
    room: z.string().nullable(),
    warrantyEnd: z.string().nullable(),
  }),
  title: z.string(),
  cause: z.string().nullable(),
  status: MaintenanceStatusSchema,
  createdFromAlarmId: z.string().nullable(),
  notes: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaintenanceTask = z.infer<typeof MaintenanceTaskSchema>;

export const MaintenanceQuerySchema = PageQuerySchema.extend({
  status: MaintenanceStatusSchema.optional(),
  assetId: IdSchema.optional(),
});
export const MaintenanceResponseSchema = pageOf(MaintenanceTaskSchema);
export type MaintenanceResponse = z.infer<typeof MaintenanceResponseSchema>;

export const CreateMaintenanceTaskSchema = z.object({
  assetId: IdSchema,
  title: z.string().min(1).max(200),
  cause: z.string().max(500).optional(),
});
export type CreateMaintenanceTask = z.infer<typeof CreateMaintenanceTaskSchema>;

export const UpdateMaintenanceTaskSchema = z.object({
  status: MaintenanceStatusSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateMaintenanceTask = z.infer<typeof UpdateMaintenanceTaskSchema>;
