import type {
  AutomationKey,
  AutomationParams,
  Decision,
  PeakSheddingState,
} from '@platform/shared/dto';
import type { DeviceLiveState } from '@platform/shared/dto';
import type { AssetRow, HoldRow, LocationRow } from '../../db/schema/index.js';
import type { BookingWithRefs } from '../bookings/bookings.service.js';
import type { RoomPresence } from '../rooms/presence.service.js';

/** A controllable or measuring device in a room, with its latest values. */
export interface DeviceState {
  assetId: string;
  code: string;
  deviceType: string;
  sweepable: boolean;
  online: boolean;
  values: DeviceLiveState['values'];
}

export interface RoomState {
  room: LocationRow;
  devices: DeviceState[];
  presence: RoomPresence | undefined;
  lightsOn: boolean;
  acOn: boolean;
  powerW: number | null;
}

/** An online laptop with the person behind it, for zone keeping and late-worker notifications. */
export interface PersonPresence {
  laptopCode: string;
  room: string;
  zone: string | null;
  employeeId: string | null;
  employeeName: string | null;
  /** Platform user linked to the employee, when one exists (gets the notification). */
  userId: string | null;
}

/** Everything a rule may look at; built once per tick and shared by every rule. */
export interface RuleContext {
  tenant: { id: string; key: string; tariffPerKwh: number };
  /** Business time in ms. */
  now: number;
  timeZone: string;
  rooms: RoomState[];
  /** ACTIVE bookings intersecting today (business day). */
  bookings: BookingWithRefs[];
  /** Holds still in force at `now`. */
  holds: HoldRow[];
  /** Narrows a manual run to one zone or floor. */
  scope?: { zone?: string; floor?: number };
  /** Online laptops with their owners. */
  people: PersonPresence[];
  /** Sum of the floor meters right now (W); null when no meter reports. */
  buildingPowerW: number | null;
  /** Enabled flag and stored params of every automation, so rules can consult each other. */
  automations: Partial<Record<AutomationKey, { enabled: boolean; params: unknown }>>;
  /** Business day (YYYY-MM-DD) each once-a-day automation last acted on. */
  lastActedDay: Partial<Record<AutomationKey, string>>;
  /** Peak-shedding state machine as persisted after the previous run. */
  shedState: PeakSheddingState;
  /** True for a manual run ("Run now", "Leaving now"): time-of-day gates do not apply. */
  manual: boolean;
  /** Manual peak-shedding action. */
  action?: 'shed' | 'restore';
}

export interface Rule<K extends AutomationKey = AutomationKey> {
  key: K;
  evaluate(ctx: RuleContext, params: AutomationParams[K]): Decision[];
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isOn(d: DeviceState): boolean {
  return num(d.values.state) === 1;
}

/** Assembles room states from location rows, assets and the live snapshot. Pure. */
export function buildRoomStates(
  rooms: LocationRow[],
  assetRows: AssetRow[],
  devices: DeviceLiveState[],
  presence: Map<string, RoomPresence>,
): RoomState[] {
  const liveByCode = new Map(devices.map((d) => [d.deviceCode, d]));
  return rooms.map((room) => {
    const inRoom = assetRows
      .filter((a) => a.locationId === room.id && a.tbDeviceId && a.deviceType)
      .map((a): DeviceState => {
        const live = liveByCode.get(a.code);
        return {
          assetId: a.id,
          code: a.code,
          deviceType: a.deviceType!,
          sweepable: a.meta.sweepable !== false,
          online: live?.online ?? false,
          values: live?.values ?? {},
        };
      });
    const meter = inRoom.find((d) => d.deviceType === 'room_meter');
    return {
      room,
      devices: inRoom,
      presence: presence.get(room.code),
      lightsOn: inRoom.some((d) => d.deviceType === 'light' && isOn(d)),
      acOn: inRoom.some((d) => d.deviceType === 'ac' && isOn(d)),
      powerW: meter ? num(meter.values.power_w) : null,
    };
  });
}

/**
 * Presence with some laptops treated as gone ("Leaving now"): the room stays occupied only if the
 * sensor sees people or another laptop is online. Pure.
 */
export function withoutLaptops(presence: RoomPresence, codes: Set<string>): RoomPresence {
  const laptopCodes = presence.laptopCodes.filter((c) => !codes.has(c));
  if (laptopCodes.length === presence.laptopCodes.length) return presence;
  const occupied = presence.sensorOccupied || laptopCodes.length > 0;
  return {
    ...presence,
    laptopCodes,
    laptopsOnline: laptopCodes.length,
    occupied,
    count: presence.sensorOccupied ? presence.count : laptopCodes.length,
    emptySince: occupied ? presence.emptySince : (presence.emptySince ?? presence.updatedAt),
  };
}

/** Whether a hold covers the room right now. */
export function roomHeld(room: LocationRow, holds: HoldRow[], now: number): boolean {
  return holds.some(
    (h) =>
      h.until.getTime() > now &&
      ((h.scopeType === 'ROOM' && h.scopeId === room.code) ||
        (h.scopeType === 'ZONE' && h.scopeId === room.zone) ||
        (h.scopeType === 'FLOOR' && room.floor !== null && h.scopeId === String(room.floor))),
  );
}

export function inScope(room: LocationRow, scope: RuleContext['scope']): boolean {
  if (!scope) return true;
  if (scope.zone && room.zone !== scope.zone) return false;
  if (scope.floor !== undefined && room.floor !== scope.floor) return false;
  return true;
}

/** Commands that switch off everything sweepable in a room (lights, AC, sweepable plugs). */
export function switchOffDecisions(state: RoomState, reason: string): Decision[] {
  return state.devices
    .filter(
      (d) =>
        (d.deviceType === 'light' ||
          d.deviceType === 'ac' ||
          (d.deviceType === 'plug' && d.sweepable)) &&
        isOn(d),
    )
    .map((d) => ({
      kind: 'command' as const,
      room: state.room.code,
      deviceCode: d.code,
      assetId: d.assetId,
      method: 'setState' as const,
      params: { state: 0 },
      reason,
    }));
}
