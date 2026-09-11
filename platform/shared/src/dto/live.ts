import { z } from 'zod';
import { TelemetryValuesSchema } from '../contracts/mqtt.js';

/** Latest known state of one device, kept in Redis and sent as the snapshot after connect. */
export const DeviceLiveStateSchema = z.object({
  deviceCode: z.string(),
  deviceType: z.string().nullable(),
  tbDeviceId: z.string().nullable(),
  room: z.string().nullable(),
  online: z.boolean(),
  /** ms timestamp of the last message. */
  ts: z.number().int().nullable(),
  values: TelemetryValuesSchema,
  activeAlarms: z.array(z.string()).default([]),
});
export type DeviceLiveState = z.infer<typeof DeviceLiveStateSchema>;

export const LiveSnapshotSchema = z.object({
  tenantKey: z.string(),
  /** Stream id of the newest event included in this snapshot. */
  lastEventId: z.string().nullable(),
  devices: z.array(DeviceLiveStateSchema),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;
