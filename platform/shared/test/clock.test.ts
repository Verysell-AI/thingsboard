import { describe, expect, it } from 'vitest';
import {
  ClockCommandSchema,
  applyClockCommand,
  isLiveClock,
  liveClock,
  virtualNow,
  zoneOffsetMinutes,
  zonedDateParts,
  zonedDayKey,
  zonedMinutesOfDay,
  zonedTimeToEpoch,
} from '../src/clock.js';

const TZ = 'Asia/Dubai';
/** 2026-09-07 10:00 in Dubai (UTC+4) is 06:00 UTC. */
const MON_10 = Date.UTC(2026, 8, 7, 6, 0, 0);
const HOUR = 3_600_000;

describe('zone helpers', () => {
  it('reads Dubai wall-clock fields from an instant', () => {
    expect(zonedDateParts(MON_10, TZ)).toEqual({
      year: 2026,
      month: 9,
      day: 7,
      hour: 10,
      minute: 0,
      second: 0,
      weekday: 1,
    });
    expect(zonedMinutesOfDay(MON_10, TZ)).toBe(600);
    expect(zonedDayKey(MON_10, TZ)).toBe('2026-09-07');
    expect(zoneOffsetMinutes(MON_10, TZ)).toBe(240);
  });

  it('converts wall-clock fields back to an instant, with day overflow', () => {
    expect(zonedTimeToEpoch({ year: 2026, month: 9, day: 7, hour: 10, minute: 0 }, TZ)).toBe(
      MON_10,
    );
    expect(zonedTimeToEpoch({ year: 2026, month: 9, day: 31, hour: 0, minute: 0 }, TZ)).toBe(
      zonedTimeToEpoch({ year: 2026, month: 10, day: 1, hour: 0, minute: 0 }, TZ),
    );
    // midnight in Dubai is 20:00 UTC the day before
    expect(zonedDateParts(MON_10 - 10 * HOUR, 'UTC').hour).toBe(20);
    expect(zonedDateParts(MON_10 - 10 * HOUR, TZ).hour).toBe(0);
  });

  it('handles a daylight-saving zone', () => {
    const summer = zonedTimeToEpoch(
      { year: 2026, month: 7, day: 1, hour: 12, minute: 0 },
      'Europe/Paris',
    );
    const winter = zonedTimeToEpoch(
      { year: 2026, month: 1, day: 1, hour: 12, minute: 0 },
      'Europe/Paris',
    );
    expect(zoneOffsetMinutes(summer, 'Europe/Paris')).toBe(120);
    expect(zoneOffsetMinutes(winter, 'Europe/Paris')).toBe(60);
    expect(zonedDateParts(summer, 'Europe/Paris').hour).toBe(12);
    expect(zonedDateParts(winter, 'Europe/Paris').hour).toBe(12);
  });
});

describe('clock state', () => {
  it('a live clock reads the real time', () => {
    const c = liveClock();
    expect(isLiveClock(c)).toBe(true);
    expect(virtualNow(c, MON_10)).toBe(MON_10);
  });

  it('jumpBy and jumpTo move the anchor and keep the speed', () => {
    let c = applyClockCommand(liveClock(), { op: 'jumpBy', ms: 10 * 60_000 }, MON_10, TZ);
    expect(virtualNow(c, MON_10)).toBe(MON_10 + 10 * 60_000);
    expect(virtualNow(c, MON_10 + 1000)).toBe(MON_10 + 10 * 60_000 + 1000);
    expect(isLiveClock(c)).toBe(false);
    c = applyClockCommand(c, { op: 'jumpTo', at: MON_10 }, MON_10 + 5000, TZ);
    expect(virtualNow(c, MON_10 + 5000)).toBe(MON_10);
  });

  it('jumpToTime targets a wall-clock time on the current virtual day in the zone', () => {
    const c = applyClockCommand(
      liveClock(),
      { op: 'jumpToTime', time: '20:00', dayOffset: 0 },
      MON_10,
      TZ,
    );
    const v = virtualNow(c, MON_10);
    expect(zonedDateParts(v, TZ)).toMatchObject({ day: 7, hour: 20, minute: 0, second: 0 });
    const tomorrow = applyClockCommand(
      c,
      { op: 'jumpToTime', time: '07:00', dayOffset: 1 },
      MON_10,
      TZ,
    );
    expect(zonedDateParts(virtualNow(tomorrow, MON_10), TZ)).toMatchObject({
      day: 8,
      hour: 7,
      weekday: 2,
    });
  });

  it('speed scales elapsed real time; 0 pauses; reset returns to live', () => {
    const fast = applyClockCommand(liveClock(), { op: 'speed', speed: 60 }, MON_10, TZ);
    expect(virtualNow(fast, MON_10)).toBe(MON_10);
    expect(virtualNow(fast, MON_10 + 10_000)).toBe(MON_10 + 600_000);
    const paused = applyClockCommand(fast, { op: 'speed', speed: 0 }, MON_10 + 10_000, TZ);
    expect(virtualNow(paused, MON_10 + 60_000)).toBe(MON_10 + 600_000);
    const live = applyClockCommand(paused, { op: 'reset' }, MON_10 + 60_000, TZ);
    expect(isLiveClock(live)).toBe(true);
    expect(virtualNow(live, MON_10 + 60_000)).toBe(MON_10 + 60_000);
  });

  it('validates commands', () => {
    expect(ClockCommandSchema.safeParse({ op: 'jumpToTime', time: '24:00' }).success).toBe(false);
    expect(ClockCommandSchema.safeParse({ op: 'jumpToTime', time: '19:55' }).success).toBe(true);
    expect(ClockCommandSchema.safeParse({ op: 'speed', speed: 10_000 }).success).toBe(false);
    expect(ClockCommandSchema.safeParse({ op: 'jumpBy', ms: -3 * 24 * HOUR }).success).toBe(false);
    expect(ClockCommandSchema.parse({ op: 'jumpToTime', time: '08:00' })).toEqual({
      op: 'jumpToTime',
      time: '08:00',
      dayOffset: 0,
    });
  });
});
