import { describe, expect, it } from 'vitest';
import { zonedDateParts } from '@platform/shared/clock';
import type { EmployeeSeed, Room } from '@platform/shared/dataset';
import { DATASET_BOOKING_TITLES, generateBookingCalendar } from './dataset-bookings.js';

const TZ = 'Asia/Dubai';
const rooms: Room[] = ['1.1', '1.2', '1.3', '1.4', '2.1'].map((code, i) => ({
  code,
  name: `Meeting room ${code}`,
  floor: Number(code[0]),
  kind: 'meeting',
  zone: '1.West',
  capacity: 4 + 2 * i,
  critical: false,
  geometry: { x: 0, y: 0, w: 10, h: 10 },
}));
rooms.push({
  code: '1.O',
  name: 'Open plan',
  floor: 1,
  kind: 'open_plan',
  zone: '1.West',
  critical: false,
  geometry: { x: 0, y: 0, w: 10, h: 10 },
});
const employees: EmployeeSeed[] = Array.from({ length: 6 }, (_, i) => ({
  code: `E00${i + 1}`,
  name: `Person ${i + 1}`,
  department: 'Sales',
  deskRoom: '1.O',
  desk: `D-1.O-0${i + 1}`,
  persona: 'standard',
  email: `p${i + 1}@alpha.demo`,
}));

// Wednesday 2026-09-09 11:00 Dubai
const NOW = Date.UTC(2026, 8, 9, 7);

describe('generateBookingCalendar', () => {
  const cal = generateBookingCalendar({
    tenantKey: 'alpha',
    rooms,
    employees,
    now: NOW,
    timeZone: TZ,
  });

  it('is deterministic for the same inputs', () => {
    const again = generateBookingCalendar({
      tenantKey: 'alpha',
      rooms,
      employees,
      now: NOW + 3_600_000,
      timeZone: TZ,
    });
    expect(again.bookings).toEqual(cal.bookings);
    const beta = generateBookingCalendar({
      tenantKey: 'beta',
      rooms,
      employees,
      now: NOW,
      timeZone: TZ,
    });
    expect(beta.bookings).not.toEqual(cal.bookings);
  });

  it('covers ten weekdays over two weeks, only meeting rooms, 2-5 bookings per room per day', () => {
    expect(zonedDateParts(cal.from, TZ)).toMatchObject({ day: 7, weekday: 1, hour: 0 });
    const perRoomDay = new Map<string, number>();
    for (const b of cal.bookings) {
      const p = zonedDateParts(b.start, TZ);
      expect(p.weekday).toBeGreaterThanOrEqual(1);
      expect(p.weekday).toBeLessThanOrEqual(5);
      expect(b.roomCode).not.toBe('1.O');
      expect(p.hour * 60 + p.minute).toBeGreaterThanOrEqual(9 * 60);
      expect(
        zonedDateParts(b.end, TZ).hour * 60 + zonedDateParts(b.end, TZ).minute,
      ).toBeLessThanOrEqual(18 * 60);
      expect(b.end - b.start).toBeGreaterThan(0);
      const key = `${b.roomCode}:${p.day}`;
      perRoomDay.set(key, (perRoomDay.get(key) ?? 0) + 1);
    }
    expect(perRoomDay.size).toBe(5 * 10);
    for (const n of perRoomDay.values()) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('never overlaps within a room and honours the storyline anchors', () => {
    const byRoom = new Map<string, typeof cal.bookings>();
    for (const b of cal.bookings) byRoom.set(b.roomCode, [...(byRoom.get(b.roomCode) ?? []), b]);
    for (const list of byRoom.values()) {
      for (let i = 1; i < list.length; i++)
        expect(list[i]!.start).toBeGreaterThanOrEqual(list[i - 1]!.end);
    }
    const anchors12 = cal.bookings.filter(
      (b) =>
        b.roomCode === '1.2' && zonedDateParts(b.start, TZ).hour === 9 && b.attendance === 'FULL',
    );
    const anchors14 = cal.bookings.filter(
      (b) =>
        b.roomCode === '1.4' && zonedDateParts(b.start, TZ).hour === 10 && b.attendance === 'GHOST',
    );
    expect(anchors12).toHaveLength(10);
    expect(anchors14).toHaveLength(10);
  });

  it('mixes attendance roughly 15 % ghost / 20 % late and uses only the marker titles', () => {
    const n = cal.bookings.length;
    const ghost = cal.bookings.filter((b) => b.attendance === 'GHOST').length / n;
    const late = cal.bookings.filter((b) => b.attendance === 'LATE').length / n;
    expect(ghost).toBeGreaterThan(0.08);
    expect(ghost).toBeLessThan(0.3);
    expect(late).toBeGreaterThan(0.1);
    expect(late).toBeLessThan(0.32);
    for (const b of cal.bookings) {
      expect(DATASET_BOOKING_TITLES).toContain(b.title);
      expect(employees.map((e) => e.code)).toContain(b.organiserCode);
    }
  });
});
