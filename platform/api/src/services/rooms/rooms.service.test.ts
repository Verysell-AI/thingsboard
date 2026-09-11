import { describe, expect, it } from 'vitest';
import { deriveRoomStatus, type DeviceLiveState } from '@platform/shared/dto';
import type { BookingRow, LocationRow } from '../../db/schema/index.js';
import type { BookingWithRefs } from '../bookings/bookings.service.js';
import { buildRoomView } from './rooms.service.js';

const NOW = Date.UTC(2026, 8, 7, 6, 30); // 10:30 Dubai

const room: LocationRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  type: 'ROOM',
  code: '1.1',
  name: 'Meeting room 1.1',
  parentId: null,
  tbAssetId: null,
  floor: 1,
  zone: '1.West',
  kind: 'meeting',
  capacity: 4,
  critical: false,
  geometry: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function live(
  code: string,
  deviceType: string,
  values: Record<string, number | string>,
  online = true,
  roomCode = '1.1',
): DeviceLiveState {
  return {
    deviceCode: code,
    deviceType,
    tbDeviceId: null,
    room: roomCode,
    online,
    ts: NOW,
    values,
    activeAlarms: [],
  };
}

function booking(
  start: number,
  end: number,
  status: BookingRow['status'] = 'ACTIVE',
): BookingWithRefs {
  return {
    booking: {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: room.tenantId,
      roomId: room.id,
      start: new Date(start),
      end: new Date(end),
      organiserId: null,
      title: 'Weekly sync',
      attendance: 'FULL',
      status,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    roomCode: room.code,
    organiser: null,
  };
}

describe('deriveRoomStatus', () => {
  it('is BUSY when occupied, BOOKED when only a booking is running, else FREE', () => {
    expect(deriveRoomStatus({ occupied: true, currentBooking: true })).toBe('BUSY');
    expect(deriveRoomStatus({ occupied: true, currentBooking: false })).toBe('BUSY');
    expect(deriveRoomStatus({ occupied: false, currentBooking: true })).toBe('BOOKED');
    expect(deriveRoomStatus({ occupied: false, currentBooking: false })).toBe('FREE');
  });
});

describe('buildRoomView', () => {
  const base = { now: NOW, tariffPerKwh: 0.44, energyAtMidnightKwh: 10 };

  it('derives occupancy, switches, power, energy and bookings from live state', () => {
    const view = buildRoomView(room, {
      ...base,
      devices: [
        live('OCC-1.1', 'occupancy', { occupied: 1, count: 3 }),
        live('LIGHT-1.1', 'light', { state: 1, power_w: 60 }),
        live('AC-1.1', 'ac', { state: 0, power_w: 0 }),
        live('RM-1.1', 'room_meter', { power_w: 812.5, energy_kwh: 12.5 }),
        live('LAPTOP-E001', 'laptop', { battery: 80 }, true),
        live('LAPTOP-E002', 'laptop', { battery: 50 }, false),
        live('LIGHT-1.2', 'light', { state: 1 }, true, '1.2'),
      ],
      bookings: [
        booking(NOW - 600_000, NOW + 1_800_000),
        booking(NOW + 3_600_000, NOW + 7_200_000),
      ],
    });
    expect(view).toMatchObject({
      code: '1.1',
      status: 'BUSY',
      occupied: true,
      peopleCount: 3,
      laptopsOnline: 1,
      lightsOn: true,
      acOn: false,
      powerW: 812.5,
      energyTodayKwh: 2.5,
      costToday: 1.1,
      wastingSinceMinutes: null,
    });
    expect(view.currentBooking?.title).toBe('Weekly sync');
    expect(view.nextBooking?.start).toBe(new Date(NOW + 3_600_000).toISOString());
  });

  it('a booking with nobody there is BOOKED; a cancelled one does not count', () => {
    const booked = buildRoomView(room, {
      ...base,
      devices: [live('OCC-1.1', 'occupancy', { occupied: 0, count: 0 })],
      bookings: [booking(NOW - 60_000, NOW + 60_000)],
    });
    expect(booked.status).toBe('BOOKED');
    const cancelled = buildRoomView(room, {
      ...base,
      devices: [],
      bookings: [booking(NOW - 60_000, NOW + 60_000, 'CANCELLED')],
    });
    expect(cancelled.status).toBe('FREE');
    expect(cancelled.currentBooking).toBeNull();
    expect(cancelled.energyTodayKwh).toBeNull();
  });

  it('an online laptop alone makes the room occupied (laptops as sensors)', () => {
    const view = buildRoomView(room, {
      ...base,
      devices: [live('LAPTOP-E003', 'laptop', {}, true)],
      bookings: [],
    });
    expect(view.occupied).toBe(true);
    expect(view.peopleCount).toBe(0);
    expect(view.status).toBe('BUSY');
  });

  it('never reports negative energy when the meter reset', () => {
    const view = buildRoomView(room, {
      ...base,
      energyAtMidnightKwh: 50,
      devices: [live('RM-1.1', 'room_meter', { power_w: 1, energy_kwh: 3 })],
      bookings: [],
    });
    expect(view.energyTodayKwh).toBe(0);
  });
});
