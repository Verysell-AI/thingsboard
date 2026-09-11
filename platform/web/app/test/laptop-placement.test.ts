import { describe, expect, it } from 'vitest';
import type { DeviceLiveState, FloorPlan } from '@platform/shared/dto';
import { accessPointForZoneCode, placeLaptop } from '~/lib/laptop-placement';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const loc = (over: Partial<FloorPlan['rooms'][number]>): FloorPlan['rooms'][number] => ({
  id: id(1),
  type: 'ROOM',
  code: 'X',
  name: 'X',
  parentId: null,
  floor: 1,
  zone: null,
  kind: null,
  capacity: null,
  critical: false,
  geometry: null,
  tbAssetId: null,
  accessPoint: null,
  ...over,
});

const plan: FloorPlan = {
  floor: loc({ type: 'FLOOR', code: 'F1' }),
  zones: [
    loc({ id: id(2), type: 'ZONE', code: '1.West', accessPoint: 'AP-1W' }),
    loc({ id: id(3), type: 'ZONE', code: '1.East', accessPoint: null }),
  ],
  rooms: [
    loc({
      id: id(4),
      code: '1.O',
      kind: 'open_plan',
      zone: '1.West',
      geometry: { x: 0, y: 300, w: 1000, h: 300 },
    }),
    loc({
      id: id(5),
      code: '1.3',
      kind: 'meeting',
      zone: '1.East',
      geometry: { x: 440, y: 40, w: 240, h: 180 },
    }),
    loc({
      id: id(6),
      code: '1.4',
      kind: 'meeting',
      zone: '1.East',
      geometry: { x: 700, y: 40, w: 240, h: 180 },
    }),
  ],
  desks: [{ code: 'D-1', room: '1.O', zone: '1.West', x: 100, y: 340, employeeId: null }],
  devices: [
    {
      code: 'LAPTOP-E001',
      type: 'laptop',
      name: 'L',
      room: '1.O',
      appliance: null,
      x: 100,
      y: 340,
      assetId: null,
    },
  ],
};

const laptop = plan.devices[0]!;
const live = (ap: string, online = true): DeviceLiveState => ({
  deviceCode: 'LAPTOP-E001',
  deviceType: 'laptop',
  tbDeviceId: null,
  room: '1.O',
  online,
  ts: 1,
  values: { ap },
  activeAlarms: [],
});
const occ = (room: string, count: number): DeviceLiveState => ({
  deviceCode: `OCC-${room}`,
  deviceType: 'occupancy',
  tbDeviceId: null,
  room,
  online: true,
  ts: 1,
  values: { count, occupied: count > 0 ? 1 : 0 },
  activeAlarms: [],
});

describe('laptop placement', () => {
  it('derives the access point from the zone code when the plan has none', () => {
    expect(accessPointForZoneCode('1.West')).toBe('AP-1W');
    expect(accessPointForZoneCode('2.East')).toBe('AP-2E');
  });

  it('stays at the desk on the home access point or while offline', () => {
    expect(placeLaptop(laptop, live('AP-1W'), plan, {})).toMatchObject({
      x: 100,
      y: 340,
      atDesk: true,
    });
    expect(placeLaptop(laptop, live('AP-1E', false), plan, {})).toMatchObject({ atDesk: true });
    expect(placeLaptop(laptop, undefined, plan, {})).toMatchObject({ atDesk: true });
  });

  it('moves into the occupied meeting room of the reported zone, else the first one', () => {
    const inRoom4 = placeLaptop(laptop, live('AP-1E'), plan, { 'OCC-1.4': occ('1.4', 3) });
    expect(inRoom4).toMatchObject({ room: '1.4', atDesk: false });
    expect(inRoom4!.x).toBeGreaterThan(700);
    expect(inRoom4!.x).toBeLessThan(940);
    const first = placeLaptop(laptop, live('AP-1E'), plan, {});
    expect(first).toMatchObject({ room: '1.3', atDesk: false });
    const second = placeLaptop(laptop, live('AP-1E'), plan, {}, 1);
    expect(second!.x).toBeGreaterThan(first!.x);
  });
});
