import type { ClockEvent, LiveEvent } from '@platform/shared/contracts';
import type { DeviceLiveState, LiveSnapshot } from '@platform/shared/dto';

/** Pure state for the live feed; the socket hook feeds it, tests exercise it directly. */
export interface LiveState {
  connected: boolean;
  tenantKey: string | null;
  lastEventId: string | null;
  devices: Record<string, DeviceLiveState>;
  /** Most recent events, newest first. */
  events: LiveEvent[];
  /** Last business-clock change seen on the socket (time machine), if any. */
  clock: ClockEvent | null;
  /** Latest presence per room code, from `room.presence` events. */
  presence: Record<string, RoomPresence>;
}

export interface RoomPresence {
  occupied: boolean;
  count: number;
  laptopsOnline: number;
  ts: number;
}

export const MAX_EVENTS = 50;

export const initialLiveState: LiveState = {
  connected: false,
  tenantKey: null,
  lastEventId: null,
  devices: {},
  events: [],
  clock: null,
  presence: {},
};

export type LiveAction =
  | { type: 'connected'; connected: boolean }
  | { type: 'snapshot'; snapshot: LiveSnapshot }
  | { type: 'event'; event: LiveEvent };

function ensureDevice(
  devices: Record<string, DeviceLiveState>,
  code: string,
  patch: Partial<DeviceLiveState>,
): Record<string, DeviceLiveState> {
  const current: DeviceLiveState = devices[code] ?? {
    deviceCode: code,
    deviceType: null,
    tbDeviceId: null,
    room: null,
    online: false,
    ts: null,
    values: {},
    activeAlarms: [],
  };
  return { ...devices, [code]: { ...current, ...patch } };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: action.connected };
    case 'snapshot': {
      const devices: Record<string, DeviceLiveState> = {};
      for (const d of action.snapshot.devices) devices[d.deviceCode] = d;
      return {
        ...state,
        tenantKey: action.snapshot.tenantKey,
        lastEventId: action.snapshot.lastEventId ?? state.lastEventId,
        devices,
      };
    }
    case 'event': {
      const e = action.event;
      let devices = state.devices;
      switch (e.kind) {
        case 'device.telemetry': {
          const prev = devices[e.deviceCode];
          devices = ensureDevice(devices, e.deviceCode, {
            deviceType: e.deviceType ?? prev?.deviceType ?? null,
            room: e.room ?? prev?.room ?? null,
            online: true,
            ts: e.ts,
            values: { ...(prev?.values ?? {}), ...e.values },
          });
          break;
        }
        case 'device.activity': {
          const prev = devices[e.deviceCode];
          devices = ensureDevice(devices, e.deviceCode, {
            deviceType: e.deviceType ?? prev?.deviceType ?? null,
            room: e.room ?? prev?.room ?? null,
            online: e.online,
            ts: e.ts,
          });
          break;
        }
        case 'alarm': {
          const prev = devices[e.deviceCode];
          const alarms = new Set(prev?.activeAlarms ?? []);
          if (e.status === 'cleared') alarms.delete(e.alarmType);
          else alarms.add(e.alarmType);
          devices = ensureDevice(devices, e.deviceCode, {
            room: e.room ?? prev?.room ?? null,
            activeAlarms: [...alarms],
          });
          break;
        }
        case 'room.presence':
          return {
            ...state,
            presence: {
              ...state.presence,
              [e.room]: {
                occupied: e.occupied,
                count: e.count,
                laptopsOnline: e.laptopsOnline,
                ts: e.ts,
              },
            },
            lastEventId: e.id,
            events: [e, ...state.events].slice(0, MAX_EVENTS),
          };
        case 'clock':
          return {
            ...state,
            clock: e,
            lastEventId: e.id,
            events: [e, ...state.events].slice(0, MAX_EVENTS),
          };
        default:
          break;
      }
      return {
        ...state,
        devices,
        lastEventId: e.id,
        events: [e, ...state.events].slice(0, MAX_EVENTS),
      };
    }
    default:
      return state;
  }
}

/** Devices in a room, from the live map. */
export function devicesInRoom(devices: Record<string, DeviceLiveState>, room: string) {
  return Object.values(devices).filter((d) => d.room === room);
}

export function isDeviceType(d: DeviceLiveState, type: string, codePrefix: string): boolean {
  return d.deviceType === type || (d.deviceType === null && d.deviceCode.startsWith(codePrefix));
}

/** True when any light in the room reports state 1. */
export function roomLightsOn(devices: Record<string, DeviceLiveState>, room: string): boolean {
  return devicesInRoom(devices, room).some(
    (d) => isDeviceType(d, 'light', 'LIGHT-') && Number(d.values.state) === 1,
  );
}

export function roomAcOn(devices: Record<string, DeviceLiveState>, room: string): boolean {
  return devicesInRoom(devices, room).some(
    (d) => isDeviceType(d, 'ac', 'AC-') && Number(d.values.state) === 1,
  );
}
