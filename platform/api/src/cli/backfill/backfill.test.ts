import { describe, expect, it } from 'vitest';
import type { Persona } from '@platform/shared/dataset';
import {
  AUTOMATION_OFF_MIN,
  PRE_AUTOMATION_OFF_MIN,
  bookingPeople,
  buildCalendar,
  present,
  roomAt,
  scheduleFor,
  type BackfillDay,
  type RoomDayInput,
} from './calendar.js';
import { TelemetryWriter } from './writer.js';

const TZ = 'Asia/Dubai';
// Thursday 2026-09-10 12:00 Dubai
const NOW = Date.UTC(2026, 8, 10, 8, 0);

describe('buildCalendar', () => {
  it('covers whole days up to yesterday, marks weekends, two holidays and the automation era', () => {
    const days = buildCalendar(NOW, 12, TZ);
    expect(days).toHaveLength(84);
    expect(days[0]!.date).toBe('2026-06-18');
    expect(days[83]!.date).toBe('2026-09-09');
    expect(days.filter((d) => d.weekend)).toHaveLength(24);
    const holidays = days.filter((d) => d.holiday);
    expect(holidays).toHaveLength(2);
    expect(holidays.every((d) => d.weekday === 3)).toBe(true);
    expect(days.filter((d) => d.sweepEra)).toHaveLength(28);
    expect(days.filter((d) => d.slotMs === 15 * 60_000)).toHaveLength(28);
    expect(days[0]!.slotMs).toBe(3_600_000);
    // a forgotten weekend only happens before automation
    expect(
      days.filter((d) => d.forgottenWeekend).every((d) => !d.sweepEra && (d.weekend || d.holiday)),
    ).toBe(true);
    // consecutive days are one day apart (no DST in Dubai, but the calendar must never skip)
    for (let i = 1; i < days.length; i++)
      expect(days[i]!.dayStartMs - days[i - 1]!.dayStartMs).toBe(24 * 3_600_000);
  });
});

const standard: Persona = {
  key: 'standard',
  name: 'Standard',
  arrive: '09:00',
  leave: '18:00',
  meetings: 2,
};
const remote: Persona = {
  key: 'remote_today',
  name: 'Remote',
  arrive: null,
  leave: null,
  meetings: 0,
};
const weekday = { weekend: false, holiday: false, date: '2026-09-08' };

describe('scheduleFor', () => {
  it('jitters persona hours on working days and keeps people home on weekends, holidays and remote days', () => {
    const s = scheduleFor(standard, weekday, 'alpha:E001');
    if (s.arriveMin !== null) {
      expect(Math.abs(s.arriveMin - 9 * 60)).toBeLessThanOrEqual(20);
      expect(Math.abs(s.leaveMin! - 18 * 60)).toBeLessThanOrEqual(20);
      expect(present(s, 12 * 60)).toBe(true);
      expect(present(s, 6 * 60)).toBe(false);
    }
    expect(scheduleFor(standard, { ...weekday, weekend: true }, 'x')).toEqual({
      arriveMin: null,
      leaveMin: null,
    });
    expect(scheduleFor(standard, { ...weekday, holiday: true }, 'x')).toEqual({
      arriveMin: null,
      leaveMin: null,
    });
    expect(scheduleFor(remote, weekday, 'x')).toEqual({ arriveMin: null, leaveMin: null });
    // deterministic
    expect(scheduleFor(standard, weekday, 'alpha:E001')).toEqual(s);
    // about 8 % absence over many people
    const absent = Array.from({ length: 500 }, (_, i) =>
      scheduleFor(standard, weekday, `p${i}`),
    ).filter((x) => x.arriveMin === null).length;
    expect(absent).toBeGreaterThan(15);
    expect(absent).toBeLessThan(80);
  });
});

describe('bookingPeople', () => {
  const b = { roomCode: '1.1', startMin: 600, endMin: 660, attendance: 'LATE' as const, people: 4 };
  it('brings nobody for ghosts, people after twelve minutes for late meetings', () => {
    expect(bookingPeople({ ...b, attendance: 'GHOST' }, 620)).toBe(0);
    expect(bookingPeople(b, 605)).toBe(0);
    expect(bookingPeople(b, 615)).toBe(4);
    expect(bookingPeople({ ...b, attendance: 'FULL' }, 600)).toBe(4);
    expect(bookingPeople(b, 660)).toBe(0);
  });
});

describe('roomAt', () => {
  const pre: Pick<BackfillDay, 'sweepEra' | 'weekend' | 'holiday' | 'forgottenWeekend'> = {
    sweepEra: false,
    weekend: false,
    holiday: false,
    forgottenWeekend: false,
  };
  const era = { ...pre, sweepEra: true };
  const meeting: RoomDayInput = {
    kind: 'meeting',
    critical: false,
    deskPresence: () => 0,
    bookings: [
      { roomCode: '1.1', startMin: 10 * 60, endMin: 11 * 60, attendance: 'FULL', people: 4 },
    ],
  };
  it('switches a meeting room on with its first booking and leaves it on until the cleaners (or the sweep)', () => {
    expect(roomAt(meeting, pre, 9 * 60)).toMatchObject({
      lightsOn: false,
      acOn: false,
      occupied: false,
    });
    expect(roomAt(meeting, pre, 10 * 60 + 30)).toMatchObject({
      lightsOn: true,
      acOn: true,
      occupied: true,
      people: 4,
      booked: true,
    });
    expect(roomAt(meeting, pre, 22 * 60)).toMatchObject({
      lightsOn: true,
      acOn: true,
      occupied: false,
    });
    expect(roomAt(meeting, pre, PRE_AUTOMATION_OFF_MIN)).toMatchObject({
      lightsOn: false,
      acOn: false,
    });
    // automation era: pre-cool half an hour before the first booking, off after the late worker's zone
    expect(roomAt(meeting, era, 9 * 60 + 45)).toMatchObject({ lightsOn: false, acOn: true });
    expect(roomAt(meeting, era, AUTOMATION_OFF_MIN)).toMatchObject({
      lightsOn: false,
      acOn: false,
    });
  });
  it('keeps the server room cooling, leaves closed days dark unless forgotten, and follows desks in the open plan', () => {
    const server: RoomDayInput = {
      kind: 'server',
      critical: true,
      deskPresence: () => 0,
      bookings: [],
    };
    expect(roomAt(server, pre, 3 * 60)).toMatchObject({ acOn: true, lightsOn: false });
    expect(roomAt(meeting, { ...pre, weekend: true }, 12 * 60)).toMatchObject({
      lightsOn: false,
      acOn: false,
    });
    expect(
      roomAt(meeting, { ...pre, weekend: true, forgottenWeekend: true }, 12 * 60),
    ).toMatchObject({ lightsOn: true, acOn: true });
    const open: RoomDayInput = {
      kind: 'open_plan',
      critical: false,
      deskPresence: (m) => (m >= 8 * 60 && m < 18 * 60 ? 5 : 0),
      bookings: [],
    };
    expect(roomAt(open, pre, 7 * 60)).toMatchObject({ lightsOn: false, occupied: false });
    expect(roomAt(open, pre, 9 * 60)).toMatchObject({ lightsOn: true, occupied: true, people: 5 });
    expect(roomAt(open, pre, 19 * 60)).toMatchObject({ lightsOn: true, occupied: false });
  });
});

describe('TelemetryWriter', () => {
  it('batches points per device in chunks of a thousand, caps concurrent writes and flushes the rest', async () => {
    const calls: { id: string; n: number }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const tb = {
      postTelemetry: async (id: string, points: unknown[]) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        calls.push({ id, n: points.length });
        inFlight--;
      },
    };
    const w = new TelemetryWriter(tb, 2);
    for (let i = 0; i < 2500; i++) await w.push('dev-a', { ts: i, values: { v: i } });
    for (let d = 0; d < 6; d++)
      for (let i = 0; i < 1000; i++) await w.push(`dev-${d}`, { ts: i, values: { v: i } });
    for (let i = 0; i < 10; i++) await w.push('dev-b', { ts: i, values: { v: i } });
    await w.flushAll();
    expect(calls.filter((c) => c.id === 'dev-a').map((c) => c.n)).toEqual([1000, 1000, 500]);
    expect(calls.find((c) => c.id === 'dev-b')?.n).toBe(10);
    expect(w.written).toBe(2510 + 6000);
    expect(w.requests).toBe(4 + 6);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('retries a failed batch before giving up', async () => {
    let calls = 0;
    const tb = {
      postTelemetry: async () => {
        calls++;
        if (calls < 3) throw new Error('timeout');
      },
    };
    const w = new TelemetryWriter(tb, 1, 1);
    for (let i = 0; i < 1000; i++) await w.push('dev-a', { ts: i, values: { v: i } });
    await w.flushAll();
    expect(calls).toBe(3);
    expect(w.retries).toBe(2);
    expect(w.written).toBe(1000);
  });
});
