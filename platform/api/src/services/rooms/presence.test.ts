import { describe, expect, it } from 'vitest';
import type { DeviceLiveState } from '@platform/shared/dto';
import {
  AP_DEBOUNCE_MS,
  debouncePosition,
  derivePresence,
  locateLaptop,
  type LaptopPosition,
  type RoomPresence,
  type Topology,
} from './presence.service.js';

const NOW = 1_800_000_000_000;
const topology: Topology = {
  rooms: [
    { id: 'r11', code: '1.1', kind: 'meeting', zone: '1.West', critical: false, floor: 1 },
    { id: 'r12', code: '1.2', kind: 'meeting', zone: '1.West', critical: false, floor: 1 },
    { id: 'r13', code: '1.3', kind: 'meeting', zone: '1.East', critical: false, floor: 1 },
    { id: 'r1o', code: '1.O', kind: 'open_plan', zone: '1.West', critical: false, floor: 1 },
  ],
  accessPoints: { '1.West': 'AP-1W', '1.East': 'AP-1E' },
  laptops: [
    {
      assetId: 'a1',
      code: 'LAPTOP-E001',
      deskRoom: '1.O',
      homeZone: '1.West',
      custodianEmployeeId: 'e1',
    },
    {
      assetId: 'a2',
      code: 'LAPTOP-E002',
      deskRoom: '1.O',
      homeZone: '1.West',
      custodianEmployeeId: 'e2',
    },
  ],
};

function device(
  code: string,
  deviceType: string,
  room: string,
  values: Record<string, number | string>,
  online = true,
): DeviceLiveState {
  return {
    deviceCode: code,
    deviceType,
    tbDeviceId: null,
    room,
    online,
    ts: NOW,
    values,
    activeAlarms: [],
  };
}

describe('locateLaptop', () => {
  const l = topology.laptops[0]!;
  it('is at its desk on the home access point or without an access point', () => {
    expect(locateLaptop(topology, l, 'AP-1W', new Map())).toBe('1.O');
    expect(locateLaptop(topology, l, null, new Map())).toBe('1.O');
    expect(locateLaptop(topology, l, 'AP-9Z', new Map())).toBe('1.O');
  });
  it('joins the busy meeting room of a foreign access point, else the first one', () => {
    expect(locateLaptop(topology, l, 'AP-1E', new Map([['1.3', 2]]))).toBe('1.3');
    const t2 = {
      ...topology,
      rooms: [
        ...topology.rooms,
        { id: 'r14', code: '1.4', kind: 'meeting', zone: '1.East', critical: false, floor: 1 },
      ],
    };
    expect(locateLaptop(t2, l, 'AP-1E', new Map([['1.4', 1]]))).toBe('1.4');
    expect(locateLaptop(t2, l, 'AP-1E', new Map())).toBe('1.3');
  });
});

describe('debouncePosition', () => {
  it('moves only after the new access point has been seen for a minute', () => {
    const start: LaptopPosition = { room: '1.O', since: 0, pendingRoom: null, pendingSince: null };
    const p1 = debouncePosition(start, '1.3', NOW)!;
    expect(p1.room).toBe('1.O');
    expect(p1.pendingRoom).toBe('1.3');
    const p2 = debouncePosition(p1, '1.3', NOW + AP_DEBOUNCE_MS / 2)!;
    expect(p2.room).toBe('1.O');
    const p3 = debouncePosition(p2, '1.3', NOW + AP_DEBOUNCE_MS)!;
    expect(p3.room).toBe('1.3');
    expect(p3.pendingRoom).toBeNull();
    // going back home before the minute is up cancels the move
    expect(debouncePosition(p1, '1.O', NOW + 1000)!.pendingRoom).toBeNull();
    expect(debouncePosition(undefined, '1.3', NOW)!.room).toBe('1.3');
    expect(debouncePosition(start, null, NOW)).toBeNull();
  });
});

describe('derivePresence', () => {
  it('counts laptops and sensors per room, keeps emptySince and reports changes', () => {
    const devices = [
      device('LAPTOP-E001', 'laptop', '1.O', { ap: 'AP-1W' }),
      device('LAPTOP-E002', 'laptop', '1.O', { ap: 'AP-1W' }),
      device('OCC-1.1', 'occupancy', '1.1', { occupied: 0, count: 0 }),
      device('OCC-1.3', 'occupancy', '1.3', { occupied: 1, count: 3 }),
    ];
    const first = derivePresence(topology, devices, new Map(), new Map(), NOW);
    expect(first.rooms.get('1.O')).toMatchObject({
      occupied: true,
      laptopsOnline: 2,
      laptopCodes: ['LAPTOP-E001', 'LAPTOP-E002'],
      emptySince: null,
    });
    expect(first.rooms.get('1.3')).toMatchObject({ occupied: true, count: 3, laptopsOnline: 0 });
    expect(first.rooms.get('1.1')).toMatchObject({ occupied: false, emptySince: NOW });
    expect(first.changed.sort()).toEqual(['1.1', '1.2', '1.3', '1.O']);

    // the second laptop reports the east AP: still counted at its desk until debounced
    const moved = devices.map((d) =>
      d.deviceCode === 'LAPTOP-E002' ? { ...d, values: { ap: 'AP-1E' } } : d,
    );
    const pending = derivePresence(topology, moved, first.rooms, first.laptops, NOW + 1000);
    expect(pending.laptops.get('LAPTOP-E002')).toMatchObject({ room: '1.O', pendingRoom: '1.3' });
    expect(pending.rooms.get('1.O')?.laptopsOnline).toBe(2);
    expect(pending.changed).toEqual([]);

    const later = NOW + 1000 + AP_DEBOUNCE_MS;
    const second = derivePresence(topology, moved, pending.rooms, pending.laptops, later);
    expect(second.laptops.get('LAPTOP-E002')?.room).toBe('1.3');
    expect(second.rooms.get('1.3')).toMatchObject({ laptopsOnline: 1, count: 3 });
    expect(second.rooms.get('1.O')).toMatchObject({
      laptopsOnline: 1,
      laptopCodes: ['LAPTOP-E001'],
    });
    expect(second.rooms.get('1.1')?.emptySince).toBe(NOW);
    expect(second.changed.sort()).toEqual(['1.3', '1.O']);

    const offline = derivePresence(
      topology,
      moved.map((d) => (d.deviceCode.startsWith('LAPTOP') ? { ...d, online: false } : d)),
      second.rooms,
      second.laptops,
      later + 60_000,
    );
    const open = offline.rooms.get('1.O')!;
    expect(open.occupied).toBe(false);
    expect(open.emptySince).toBe(later + 60_000);
  });

  it('places a laptop seen for the first time straight where its access point says', () => {
    const devices = [device('LAPTOP-E001', 'laptop', '1.O', { ap: 'AP-1E' })];
    const first = derivePresence(topology, devices, new Map(), new Map(), NOW);
    expect(first.laptops.get('LAPTOP-E001')).toMatchObject({ room: '1.3', pendingRoom: null });
    expect(first.rooms.get('1.3')?.laptopsOnline).toBe(1);
  });

  it('a room with a sensor uses the larger of sensor count and laptops', () => {
    const prev = new Map<string, RoomPresence>();
    const devices = [
      device('LAPTOP-E001', 'laptop', '1.O', { ap: 'AP-1W' }),
      device('OCC-1.O', 'occupancy', '1.O', { occupied: 1, count: 4 }),
    ];
    expect(derivePresence(topology, devices, prev, new Map(), NOW).rooms.get('1.O')?.count).toBe(4);
  });
});
