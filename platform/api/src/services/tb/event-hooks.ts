import { ALARM_TYPES } from '@platform/shared/contracts';
import type { Role } from '@platform/shared/roles';
import type { TelemetryValues } from '@platform/shared/contracts';
import type { DeviceLiveState } from '@platform/shared/dto';
import type { LiveStateService } from '../live/live-state.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PresenceService } from '../rooms/presence.service.js';
import type { DeviceLookup, TbEventHooks } from './tb-events.service.js';

const OPERATIONS_ROLES: Role[] = ['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR'];

/** Side effects wired by the container that the hooks only trigger (automation runs, tasks). */
export interface AutomationTriggers {
  /** A "Peak load" alarm asks for an immediate peak-shedding run. */
  onPeakAlarm?(tenant: { id: string; key: string }): Promise<void>;
  /** An "AC current high" alarm opens (or notes on) a maintenance task; returns the task id when created. */
  onAcAlarm?(
    tenant: { id: string; key: string },
    device: DeviceLookup,
    status: 'created' | 'cleared',
    alarmId: string | null,
  ): Promise<{ taskId: string; created: boolean } | null>;
}

/** Devices of a room ranked by current draw, the likely culprit of a night anomaly first. Pure. */
export function rankCulprits(
  devices: DeviceLiveState[],
  room: string,
): { code: string; deviceType: string | null; powerW: number }[] {
  return devices
    .filter((d) => d.room === room && d.deviceType !== 'room_meter' && d.deviceType !== 'occupancy')
    .map((d) => ({
      code: d.deviceCode,
      deviceType: d.deviceType,
      powerW: Number.isFinite(Number(d.values.power_w)) ? Number(d.values.power_w) : 0,
    }))
    .filter((d) => d.powerW > 0)
    .sort((a, b) => b.powerW - a.powerW);
}

/**
 * Turns ThingsBoard events into platform notifications: a laptop that goes silent is an
 * unreachable asset; a new alarm on any device is announced to operations; a night anomaly lists
 * the room's devices by power so the culprit is first; a peak-load alarm triggers shedding.
 */
export class NotifyingEventHooks implements TbEventHooks {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService | null = null,
    private readonly live: LiveStateService | null = null,
    private readonly triggers: AutomationTriggers = {},
  ) {}

  /** Laptop and occupancy telemetry moves people around; presence follows immediately. */
  async onTelemetry(device: DeviceLookup, values: TelemetryValues): Promise<void> {
    if (!this.presence) return;
    const relevant =
      (device.deviceType === 'laptop' && 'ap' in values) ||
      (device.deviceType === 'occupancy' && ('occupied' in values || 'count' in values));
    if (relevant) await this.presence.refresh(tenantOf(device)).catch(() => undefined);
  }

  async onInactivity(device: DeviceLookup): Promise<void> {
    if (device.deviceType !== 'laptop') return;
    await this.presence?.refresh(tenantOf(device)).catch(() => undefined);
    await this.notifications.create({
      tenantId: device.tenantId,
      tenantKey: device.tenantKey,
      roles: OPERATIONS_ROLES,
      kind: 'asset.unreachable',
      title: `${ALARM_TYPES.assetUnreachable}: ${device.deviceCode}`,
      body: device.room
        ? `${device.deviceCode} stopped reporting (last seen in ${device.room}).`
        : `${device.deviceCode} stopped reporting.`,
      subject: device.deviceCode,
    });
  }

  async onActivity(device: DeviceLookup): Promise<void> {
    // nothing to announce; the live state already cleared the alarm, but presence may change
    if (device.deviceType === 'laptop')
      await this.presence?.refresh(tenantOf(device)).catch(() => undefined);
  }

  async onAlarm(
    device: DeviceLookup,
    alarm: {
      type: string;
      severity: string;
      status: 'created' | 'updated' | 'cleared';
      tbAlarmId?: string;
    },
  ): Promise<void> {
    if (alarm.type === ALARM_TYPES.peakLoad && alarm.status !== 'cleared')
      await this.triggers.onPeakAlarm?.(tenantOf(device)).catch(() => undefined);
    if (alarm.type === ALARM_TYPES.acCurrentHigh && alarm.status !== 'updated') {
      const task = await this.triggers
        .onAcAlarm?.(tenantOf(device), device, alarm.status, alarm.tbAlarmId ?? null)
        .catch(() => null);
      if (alarm.status === 'created' && task?.created) {
        await this.notifications.create({
          tenantId: device.tenantId,
          tenantKey: device.tenantKey,
          roles: OPERATIONS_ROLES,
          kind: 'maintenance.task',
          title: `Check filter: ${device.deviceCode}`,
          body: `${ALARM_TYPES.acCurrentHigh}${device.room ? ` in ${device.room}` : ''}: a maintenance task was opened on the unit.`,
          subject: device.deviceCode,
        });
        return;
      }
      if (alarm.status === 'cleared') return;
    }
    if (alarm.status !== 'created') return;
    if (alarm.type === ALARM_TYPES.nightAnomaly && device.room) {
      const devices = this.live ? await this.live.snapshot(device.tenantKey) : [];
      const culprits = rankCulprits(devices, device.room);
      const list = culprits
        .slice(0, 5)
        .map((c) => `${c.code} ${Math.round(c.powerW)} W`)
        .join(', ');
      await this.notifications.create({
        tenantId: device.tenantId,
        tenantKey: device.tenantKey,
        roles: OPERATIONS_ROLES,
        kind: 'night.anomaly',
        title: `${ALARM_TYPES.nightAnomaly} in ${device.room}`,
        body: list
          ? `Unexpected load at night. By power: ${list}.`
          : `Unexpected load at night in ${device.room}.`,
        subject: culprits[0]?.code ?? device.deviceCode,
      });
      return;
    }
    await this.notifications.create({
      tenantId: device.tenantId,
      tenantKey: device.tenantKey,
      roles: OPERATIONS_ROLES,
      kind: 'alarm',
      title: `${alarm.type} on ${device.deviceCode}`,
      body: `${alarm.severity} alarm${device.room ? ` in ${device.room}` : ''}.`,
      subject: `${alarm.type}:${device.deviceCode}`,
    });
  }
}

function tenantOf(device: DeviceLookup): { id: string; key: string } {
  return { id: device.tenantId, key: device.tenantKey };
}
