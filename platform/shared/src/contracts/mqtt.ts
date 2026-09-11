import { z } from 'zod';

/**
 * MQTT contract between devices (real or simulated) and ThingsBoard.
 * Username = device access token; client id = the same token.
 */
export const MQTT_TOPICS = {
  telemetry: 'v1/devices/me/telemetry',
  attributes: 'v1/devices/me/attributes',
  rpcRequestSubscribe: 'v1/devices/me/rpc/request/+',
  rpcRequestPrefix: 'v1/devices/me/rpc/request/',
  rpcResponsePrefix: 'v1/devices/me/rpc/response/',
} as const;

export function rpcResponseTopic(requestId: string | number): string {
  return `${MQTT_TOPICS.rpcResponsePrefix}${requestId}`;
}

/** Extracts the request id from a topic like v1/devices/me/rpc/request/42. */
export function rpcRequestIdFromTopic(topic: string): string | undefined {
  if (!topic.startsWith(MQTT_TOPICS.rpcRequestPrefix)) return undefined;
  const id = topic.slice(MQTT_TOPICS.rpcRequestPrefix.length);
  return id.length > 0 ? id : undefined;
}

export const TelemetryValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type TelemetryValue = z.infer<typeof TelemetryValueSchema>;

export const TelemetryValuesSchema = z.record(z.string(), TelemetryValueSchema);
export type TelemetryValues = z.infer<typeof TelemetryValuesSchema>;

/** Payload published on the telemetry topic. */
export const TelemetryMessageSchema = z.object({
  ts: z.number().int().positive(),
  values: TelemetryValuesSchema,
});
export type TelemetryMessage = z.infer<typeof TelemetryMessageSchema>;

/** Client attributes published once on connect. */
export const CLIENT_ATTRIBUTES = { fw: 'sim-1.0' } as const;

/** Milliseconds without messages after which ThingsBoard marks a laptop inactive. */
export const LAPTOP_INACTIVITY_TIMEOUT_MS = 30_000;

/** Telemetry publish interval per device. */
export const DEFAULT_TICK_MS = 10_000;
