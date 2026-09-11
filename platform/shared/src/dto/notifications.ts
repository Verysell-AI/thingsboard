import { z } from 'zod';
import { IdSchema, PageQuerySchema, pageOf } from './common.js';

/** Kinds emitted by the platform; the web maps them to icons and deep links. */
export const NOTIFICATION_KINDS = [
  'asset.unreachable',
  'alarm',
  'booking.released',
  'sweep.late_worker',
  'sweep.summary',
  'asset.misplaced',
  'maintenance.task',
  'peak.shedding',
  'night.anomaly',
  'info',
] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationActionSchema = z.object({ key: z.string(), label: z.string() });
export type NotificationAction = z.infer<typeof NotificationActionSchema>;

export const NotificationSchema = z.object({
  id: IdSchema,
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** Related entity (asset code, room code, alarm id) for deep links. */
  subject: z.string().nullable(),
  actions: z.array(NotificationActionSchema),
  readAt: z.string().nullable(),
  actedAt: z.string().nullable(),
  actedKey: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationsQuerySchema = PageQuerySchema.extend({
  unread: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

export const NotificationsResponseSchema = pageOf(NotificationSchema).extend({
  unread: z.number().int().min(0),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;

export const NotificationActRequestSchema = z.object({ key: z.string().min(1) });
export type NotificationActRequest = z.infer<typeof NotificationActRequestSchema>;
