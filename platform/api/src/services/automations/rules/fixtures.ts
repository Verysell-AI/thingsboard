import type { AssetRow, HoldRow, LocationRow } from '../../../db/schema/index.js';
import type { BookingWithRefs } from '../../bookings/bookings.service.js';
import type { RoomPresence } from '../../rooms/presence.service.js';
import { buildRoomStates, type PersonPresence, type RuleContext } from '../context.js';
import { emptyShedState } from './peak-shedding.rule.js';

/** Shared fixtures for rule tests: rows, presence and a rule context built the way the engine does. */
export const NOW = Date.UTC(2026, 8, 7, 8, 0); // 12:00 Dubai
export const MIN = 60_000;
export const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Distinct id per code (a plain character sum would collide for anagrams such as 1.O / 1.1). */
export const idFor = (code: string) =>
  id(code.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1) * 131, 0));

export function room(code: string, over: Partial<LocationRow> = {}): LocationRow {
  return {
    id: idFor(code),
    tenantId: TENANT,
    type: 'ROOM',
    code,
    name: `Room ${code}`,
    parentId: null,
    tbAssetId: null,
    floor: 1,
    zone: '1.West',
    kind: 'meeting',
    capacity: 6,
    critical: false,
    geometry: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function asset(
  code: string,
  deviceType: string,
  roomId: string,
  sweepable = true,
): AssetRow {
  return {
    id: idFor(code),
    tenantId: TENANT,
    code,
    name: code,
    class: 'device',
    type: deviceType,
    brand: null,
    model: null,
    serial: null,
    category: null,
    locationId: roomId,
    custodianEmployeeId: null,
    purchaseDate: null,
    purchaseCost: null,
    usefulLifeYears: null,
    warrantyEnd: null,
    status: 'ACTIVE',
    tbDeviceId: `tb-${code}`,
    deviceType,
    meta: { sweepable },
    misplacedRoomId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as AssetRow;
}

export function presence(roomCode: string, over: Partial<RoomPresence>): RoomPresence {
  return {
    room: roomCode,
    occupied: false,
    sensorOccupied: false,
    count: 0,
    laptopsOnline: 0,
    laptopCodes: [],
    emptySince: NOW - 30 * MIN,
    updatedAt: NOW,
    ...over,
  };
}

export interface CtxOptions {
  people?: PersonPresence[];
  buildingPowerW?: number | null;
  now?: number;
  manual?: boolean;
  action?: 'shed' | 'restore';
  automations?: RuleContext['automations'];
  lastActedDay?: RuleContext['lastActedDay'];
  shedState?: RuleContext['shedState'];
  scope?: RuleContext['scope'];
}

export function ctx(
  rooms: LocationRow[],
  assetRows: AssetRow[],
  live: { code: string; values: Record<string, number | string>; online?: boolean }[],
  presences: Record<string, Partial<RoomPresence>>,
  bookings: BookingWithRefs[] = [],
  holds: HoldRow[] = [],
  opts: CtxOptions = {},
): RuleContext {
  const devices = live.map((l) => ({
    deviceCode: l.code,
    deviceType: assetRows.find((a) => a.code === l.code)?.deviceType ?? null,
    tbDeviceId: null,
    room:
      rooms.find((r) => r.id === assetRows.find((a) => a.code === l.code)?.locationId)?.code ??
      null,
    online: l.online ?? true,
    ts: NOW,
    values: l.values,
    activeAlarms: [],
  }));
  const pm = new Map<string, RoomPresence>();
  for (const [code, p] of Object.entries(presences)) pm.set(code, presence(code, p));
  return {
    tenant: { id: TENANT, key: 'alpha', tariffPerKwh: 0.44 },
    now: opts.now ?? NOW,
    timeZone: 'Asia/Dubai',
    rooms: buildRoomStates(rooms, assetRows, devices, pm),
    bookings,
    holds,
    scope: opts.scope,
    people: opts.people ?? [],
    buildingPowerW: opts.buildingPowerW ?? null,
    automations: opts.automations ?? {},
    lastActedDay: opts.lastActedDay ?? {},
    shedState: opts.shedState ?? emptyShedState(),
    manual: opts.manual ?? false,
    action: opts.action,
  };
}

export function booking(
  roomRow: LocationRow,
  startOffsetMin: number,
  status = 'ACTIVE',
): BookingWithRefs {
  return {
    booking: {
      id: id(900 + startOffsetMin),
      tenantId: TENANT,
      roomId: roomRow.id,
      start: new Date(NOW + startOffsetMin * MIN),
      end: new Date(NOW + (startOffsetMin + 60) * MIN),
      organiserId: null,
      title: 'Sync',
      attendance: 'GHOST',
      status: status as BookingWithRefs['booking']['status'],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    roomCode: roomRow.code,
    organiser: null,
  };
}
