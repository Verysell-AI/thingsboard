import type {
  AlarmSeverity,
  LiveEvent,
  TbEventPayload,
  TelemetryValues,
} from '@platform/shared/contracts';
import { ALARM_TYPES, STALE_TELEMETRY_MS, TelemetryValueSchema } from '@platform/shared/contracts';
import type { LiveStateService } from '../live/live-state.service.js';
import type { LiveEventInput, ReplayService } from '../live/replay.service.js';

/** What the ingress needs to know about a device, resolved from its ThingsBoard id. */
export interface DeviceLookup {
  tenantId: string;
  tenantKey: string;
  assetId: string;
  deviceCode: string;
  deviceType: string | null;
  room: string | null;
}

export interface DeviceResolver {
  byTbDeviceId(tbDeviceId: string): Promise<DeviceLookup | null>;
}

/** Side effects of events beyond live state (notifications, tasks); all optional. */
export interface TbEventHooks {
  /** Telemetry accepted into live state (after the upsert). */
  onTelemetry?(device: DeviceLookup, values: TelemetryValues, ts: number): Promise<void>;
  onInactivity?(device: DeviceLookup, ts: number): Promise<void>;
  onActivity?(device: DeviceLookup, ts: number): Promise<void>;
  onAlarm?(
    device: DeviceLookup,
    alarm: {
      type: string;
      severity: AlarmSeverity;
      status: 'created' | 'updated' | 'cleared';
      tbAlarmId?: string;
    },
    ts: number,
  ): Promise<void>;
}

export type IngressResult =
  | { outcome: 'accepted'; event: LiveEvent }
  | { outcome: 'ignored'; reason: 'unknown-device' | 'stale' | 'empty' };

const SEVERITIES: AlarmSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INDETERMINATE'];

/**
 * Handles POST /internal/tb/events: maps the ThingsBoard originator to a tenant device, updates
 * live state and fans the event out through the replay stream and pub/sub.
 */
export class TbEventsService {
  constructor(
    private readonly devices: DeviceResolver,
    private readonly live: LiveStateService,
    private readonly replay: ReplayService,
    private readonly now: () => number = Date.now,
    private hooks: TbEventHooks = {},
  ) {}

  /** Installs the side-effect hooks (the container wires notifications after both exist). */
  setHooks(hooks: TbEventHooks): void {
    this.hooks = hooks;
  }

  async handle(payload: TbEventPayload): Promise<IngressResult> {
    const device = await this.devices.byTbDeviceId(payload.originator.id);
    if (!device) return { outcome: 'ignored', reason: 'unknown-device' };

    const base = {
      tenantKey: device.tenantKey,
      ts: payload.ts,
      deviceCode: device.deviceCode,
      deviceType: device.deviceType ?? undefined,
      room: device.room ?? undefined,
    };

    switch (payload.type) {
      case 'telemetry': {
        if (this.now() - payload.ts > STALE_TELEMETRY_MS)
          return { outcome: 'ignored', reason: 'stale' };
        const values = telemetryValues(payload.data);
        if (Object.keys(values).length === 0) return { outcome: 'ignored', reason: 'empty' };
        await this.live.upsert(device.tenantKey, device.deviceCode, {
          values,
          ts: payload.ts,
          online: true,
          deviceType: device.deviceType,
          room: device.room,
          tbDeviceId: payload.originator.id,
        });
        const accepted = await this.emit(device.tenantKey, {
          ...base,
          kind: 'device.telemetry',
          values,
        });
        await this.hooks.onTelemetry?.(device, values, payload.ts);
        return accepted;
      }
      case 'attributes': {
        await this.live.upsert(device.tenantKey, device.deviceCode, {
          ts: payload.ts,
          deviceType: device.deviceType,
          room: device.room,
        });
        return this.emit(device.tenantKey, {
          ...base,
          kind: 'device.attributes',
          attributes: payload.data,
        });
      }
      case 'activity':
      case 'connect':
      case 'inactivity':
      case 'disconnect': {
        const online = payload.type === 'activity' || payload.type === 'connect';
        // A silent laptop is an unreachable asset; the API raises that alarm itself (no rule in the profile).
        const laptop = device.deviceType === 'laptop';
        const unreachable = laptop && payload.type === 'inactivity';
        await this.live.upsert(device.tenantKey, device.deviceCode, {
          online,
          ts: payload.ts,
          deviceType: device.deviceType,
          room: device.room,
          tbDeviceId: payload.originator.id,
          ...(unreachable ? { alarmAdd: ALARM_TYPES.assetUnreachable } : {}),
          ...(laptop && online ? { alarmRemove: ALARM_TYPES.assetUnreachable } : {}),
        });
        const result = await this.emit(device.tenantKey, {
          ...base,
          kind: 'device.activity',
          online,
        });
        if (unreachable) {
          await this.emit(device.tenantKey, {
            ...base,
            kind: 'alarm',
            alarmType: ALARM_TYPES.assetUnreachable,
            severity: 'WARNING',
            status: 'created',
          });
          await this.hooks.onInactivity?.(device, payload.ts);
        } else if (online) {
          await this.hooks.onActivity?.(device, payload.ts);
        } else {
          await this.hooks.onInactivity?.(device, payload.ts);
        }
        return result;
      }
      case 'alarm_created':
      case 'alarm_updated':
      case 'alarm_cleared': {
        const status =
          payload.type === 'alarm_created'
            ? 'created'
            : payload.type === 'alarm_updated'
              ? 'updated'
              : 'cleared';
        const alarmType = str(payload.data.type) ?? str(payload.metadata.alarmType) ?? 'Alarm';
        const rawSeverity = (
          str(payload.data.severity) ??
          str(payload.metadata.alarmSeverity) ??
          'WARNING'
        ).toUpperCase();
        const severity = (
          SEVERITIES.includes(rawSeverity as AlarmSeverity) ? rawSeverity : 'INDETERMINATE'
        ) as AlarmSeverity;
        const alarmId = idOf(payload.data.id);
        await this.live.upsert(device.tenantKey, device.deviceCode, {
          ts: payload.ts,
          deviceType: device.deviceType,
          room: device.room,
          ...(status === 'cleared' ? { alarmRemove: alarmType } : { alarmAdd: alarmType }),
        });
        const result = await this.emit(device.tenantKey, {
          ...base,
          kind: 'alarm',
          alarmType,
          severity,
          status,
          tbAlarmId: alarmId,
        });
        await this.hooks.onAlarm?.(
          device,
          { type: alarmType, severity, status, tbAlarmId: alarmId },
          payload.ts,
        );
        return result;
      }
    }
  }

  private async emit(tenantKey: string, event: LiveEventInput): Promise<IngressResult> {
    const stored = await this.replay.append(tenantKey, event);
    return { outcome: 'accepted', event: stored };
  }
}

function telemetryValues(data: Record<string, unknown>): TelemetryValues {
  const out: TelemetryValues = {};
  for (const [k, v] of Object.entries(data)) {
    const parsed = TelemetryValueSchema.safeParse(v);
    if (parsed.success) out[k] = parsed.data;
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function idOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'id' in v && typeof (v as { id: unknown }).id === 'string')
    return (v as { id: string }).id;
  return undefined;
}
