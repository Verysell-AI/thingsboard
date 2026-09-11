import { describe, expect, it } from 'vitest';
import {
  heatmapFrom,
  recommendationFor,
  weekdayOf,
  weekdaysBetween,
  workingShares,
} from './utilisation.service.js';

describe('utilisation', () => {
  // 2026-09-07 is a Monday, 2026-09-14 the next
  const rows = [
    { date: '2026-09-07', hour: 9, occupiedMinutes: 60, bookedMinutes: 60 },
    { date: '2026-09-07', hour: 10, occupiedMinutes: 30, bookedMinutes: 60 },
    { date: '2026-09-14', hour: 9, occupiedMinutes: 0, bookedMinutes: 60 },
    { date: '2026-09-12', hour: 9, occupiedMinutes: 60, bookedMinutes: 0 }, // a Saturday
  ];
  it('averages occupied shares per weekday and hour', () => {
    expect(weekdayOf('2026-09-07')).toBe(1);
    const map = heatmapFrom(rows);
    expect(map).toHaveLength(7);
    expect(map[1]![9]).toBe(0.5); // two Mondays, one full
    expect(map[1]![10]).toBe(0.25);
    expect(map[6]![9]).toBe(1);
    expect(map[2]![9]).toBe(0);
  });
  it('measures working-hour shares over weekdays only', () => {
    // one weekday of 600 working minutes
    expect(workingShares(rows, 1)).toEqual({ utilisation: 0.15, booked: 0.3 });
    expect(workingShares([], 0)).toEqual({ utilisation: 0, booked: 0 });
  });
  it('recommends only for meeting rooms', () => {
    expect(recommendationFor(0.1, 0, 'meeting')).toMatch(/Rarely used/);
    expect(recommendationFor(0.5, 0.4, 'meeting')).toMatch(/Ghost bookings/);
    expect(recommendationFor(0.5, 0.1, 'meeting')).toBeNull();
    expect(recommendationFor(0.1, 0.5, 'open_plan')).toBeNull();
  });
  it('counts weekdays in a range', () => {
    const mon = Date.UTC(2026, 8, 6, 20); // Monday 00:00 Dubai
    expect(weekdaysBetween(mon, mon + 7 * 24 * 3_600_000, 'Asia/Dubai')).toBe(5);
  });
});
