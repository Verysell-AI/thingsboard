import { describe, expect, it } from 'vitest';
import { zonedDateParts } from '@platform/shared/clock';
import { expectedAttendees, overlaps, startOfDay } from './bookings.service.js';

describe('booking helpers', () => {
  it('detects overlapping half-open intervals', () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);
    expect(overlaps(5, 15, 0, 10)).toBe(true);
    expect(overlaps(0, 10, 10, 20)).toBe(false); // back to back is fine
    expect(overlaps(0, 10, 20, 30)).toBe(false);
    expect(overlaps(0, 30, 10, 20)).toBe(true); // containment
  });

  it('ghost meetings bring nobody; others 2..6 people capped by capacity, stable per id', () => {
    expect(expectedAttendees('abc', 'GHOST', 12)).toBe(0);
    const a = expectedAttendees('booking-1', 'FULL', 12);
    expect(a).toBeGreaterThanOrEqual(2);
    expect(a).toBeLessThanOrEqual(6);
    expect(expectedAttendees('booking-1', 'LATE', 12)).toBe(a);
    expect(expectedAttendees('booking-1', 'FULL', 2)).toBe(2);
    expect(expectedAttendees('booking-1', 'FULL', null)).toBe(a);
  });

  it('startOfDay is local midnight in the zone', () => {
    const tenThirty = Date.UTC(2026, 8, 7, 6, 30); // 10:30 Dubai
    const midnight = startOfDay(tenThirty, 'Asia/Dubai');
    expect(zonedDateParts(midnight, 'Asia/Dubai')).toMatchObject({ day: 7, hour: 0, minute: 0 });
    expect(midnight).toBe(Date.UTC(2026, 8, 6, 20));
    // just after midnight Dubai is still the previous day in UTC
    const early = Date.UTC(2026, 8, 6, 20, 5);
    expect(startOfDay(early, 'Asia/Dubai')).toBe(midnight);
  });
});
