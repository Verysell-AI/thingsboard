import { z } from 'zod';
import { ClockStateSchema } from '../clock.js';
import { TelemetryValuesSchema } from './mqtt.js';

/**
 * Events flowing ThingsBoard -> API (rule chain REST node) and API -> web (Socket.IO).
 */

/** Kinds set by the rule chain's transform nodes before the REST call. */
export const TB_EVENT_KINDS = [
  'telemetry',
  'attributes',
  'activity',
  'inactivity',
  'connect',
  'disconnect',
  'alarm_created',
  'alarm_updated',
  'alarm_cleared',
] as const;
export const TbEventKindSchema = z.enum(TB_EVENT_KINDS);
export type TbEventKind = z.infer<typeof TbEventKindSchema>;

export const TbOriginatorSchema = z.object({
  /** ThingsBoard entity UUID. */
  id: z.string().uuid(),
  entityType: z.enum(['DEVICE', 'ASSET']).default('DEVICE'),
  /** Entity name; for dataset devices this is the device code. */
  name: z.string(),
  /** Device profile name (light, ac, laptop, ...). */
  type: z.string().optional(),
});

/** Body posted by the rule chain to POST /internal/tb/events. */
export const TbEventPayloadSchema = z.object({
  type: TbEventKindSchema,
  originator: TbOriginatorSchema,
  /** Message timestamp in ms. */
  ts: z.number().int().positive(),
  /** Message body: telemetry values, attributes, or the alarm object. */
  data: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type TbEventPayload = z.infer<typeof TbEventPayloadSchema>;

/** Header carrying the shared secret on internal calls. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** Telemetry older than this is ignored by the live pipeline (backfill safety). */
export const STALE_TELEMETRY_MS = 5 * 60_000;

export const ALARM_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INDETERMINATE'] as const;
export const AlarmSeveritySchema = z.enum(ALARM_SEVERITIES);
export type AlarmSeverity = z.infer<typeof AlarmSeveritySchema>;

/** Alarm types defined on device profiles (context §6.4). */
export const ALARM_TYPES = {
  assetUnreachable: 'Asset unreachable',
  acCurrentHigh: 'AC current high',
  peakLoad: 'Peak load',
  nightAnomaly: 'Night anomaly',
} as const;

/* ---------------------------------------------------------------------------------------------
 * Live events pushed by the API to browsers over Socket.IO.
 * ------------------------------------------------------------------------------------------- */

const liveBase = {
  /** Redis stream id, monotonic per tenant; clients send it back as lastEventId to replay. */
  id: z.string(),
  tenantKey: z.string(),
  ts: z.number().int(),
};

export const DeviceTelemetryEventSchema = z.object({
  ...liveBase,
  kind: z.literal('device.telemetry'),
  deviceCode: z.string(),
  deviceType: z.string().optional(),
  room: z.string().optional(),
  values: TelemetryValuesSchema,
});

export const DeviceActivityEventSchema = z.object({
  ...liveBase,
  kind: z.literal('device.activity'),
  deviceCode: z.string(),
  deviceType: z.string().optional(),
  room: z.string().optional(),
  online: z.boolean(),
});

export const DeviceAttributesEventSchema = z.object({
  ...liveBase,
  kind: z.literal('device.attributes'),
  deviceCode: z.string(),
  attributes: z.record(z.string(), z.unknown()),
});

export const AlarmEventSchema = z.object({
  ...liveBase,
  kind: z.literal('alarm'),
  deviceCode: z.string(),
  room: z.string().optional(),
  alarmType: z.string(),
  severity: AlarmSeveritySchema,
  status: z.enum(['created', 'updated', 'cleared']),
  tbAlarmId: z.string().optional(),
});

export const RoomPresenceEventSchema = z.object({
  ...liveBase,
  kind: z.literal('room.presence'),
  room: z.string(),
  occupied: z.boolean(),
  laptopsOnline: z.number().int().min(0),
  count: z.number().int().min(0),
});

export const AutomationRunEventSchema = z.object({
  ...liveBase,
  kind: z.literal('automation.run'),
  automationKey: z.string(),
  runId: z.string(),
  status: z.enum(['started', 'progress', 'finished']),
  summary: z.record(z.string(), z.unknown()).optional(),
});

export const NotificationEventSchema = z.object({
  ...liveBase,
  kind: z.literal('notification'),
  userId: z.string(),
  notificationId: z.string(),
  title: z.string(),
  body: z.string().optional(),
});

/** The tenant's business clock changed (time machine); `ts` is the real time of the change. */
export const ClockEventSchema = z.object({
  ...liveBase,
  kind: z.literal('clock'),
  state: ClockStateSchema,
  virtualNow: z.number().int(),
  timeZone: z.string(),
});

export type ClockEvent = z.infer<typeof ClockEventSchema>;

export const LiveEventSchema = z.discriminatedUnion('kind', [
  DeviceTelemetryEventSchema,
  DeviceActivityEventSchema,
  DeviceAttributesEventSchema,
  AlarmEventSchema,
  RoomPresenceEventSchema,
  AutomationRunEventSchema,
  NotificationEventSchema,
  ClockEventSchema,
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;
export type LiveEventKind = LiveEvent['kind'];

/** Client -> server subscription filter; an empty object means "everything in my tenant". */
export const LiveSubscriptionSchema = z.object({
  devices: z.array(z.string()).optional(),
  rooms: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
});
export type LiveSubscription = z.infer<typeof LiveSubscriptionSchema>;

/** Socket.IO event names. */
export const LIVE_SOCKET = {
  /** server -> client: one LiveEvent */
  event: 'event',
  /** server -> client: full snapshot of device live state after (re)connect */
  snapshot: 'snapshot',
  /** client -> server: LiveSubscription */
  subscribe: 'subscribe',
  /** handshake auth field names */
  authToken: 'token',
  authLastEventId: 'lastEventId',
} as const;

/** How long the replay stream keeps events for reconnecting clients. */
export const REPLAY_WINDOW_MS = 60_000;

export const redisKeys = {
  live: (tenantKey: string, deviceCode: string) => `live:${tenantKey}:${deviceCode}`,
  liveIndex: (tenantKey: string) => `live:${tenantKey}:__devices`,
  roomPresence: (tenantKey: string, room: string) => `presence:${tenantKey}:${room}`,
  eventsChannel: (tenantKey: string) => `events:${tenantKey}`,
  replayStream: (tenantKey: string) => `replay:${tenantKey}`,
  automationLock: (tenantKey: string) => `lock:automations:${tenantKey}`,
  clock: (tenantKey: string) => `clock:${tenantKey}`,
} as const;
