import { describe, expect, it } from 'vitest';
import { zonedDateParts } from '@platform/shared/clock';
import {
  energyPerBucket,
  kwhSince,
  meanSeries,
  periodStarts,
  sumSeries,
} from './energy.service.js';

const TZ = 'Asia/Dubai';

describe('energy math', () => {
  it('period starts are local midnight, Monday and the first of the month in the zone', () => {
    // Wednesday 2026-09-09 14:00 Dubai
    const now = Date.UTC(2026, 8, 9, 10);
    const s = periodStarts(now, TZ);
    expect(zonedDateParts(s.day, TZ)).toMatchObject({ day: 9, hour: 0, minute: 0 });
    expect(zonedDateParts(s.week, TZ)).toMatchObject({ day: 7, weekday: 1, hour: 0 });
    expect(zonedDateParts(s.month, TZ)).toMatchObject({ month: 9, day: 1, hour: 0 });
    // a Sunday belongs to the week that started the previous Monday
    const sunday = Date.UTC(2026, 8, 13, 10);
    expect(zonedDateParts(periodStarts(sunday, TZ).week, TZ)).toMatchObject({ day: 7, weekday: 1 });
  });

  it('kWh since a reading is the difference, never negative, null when unknown', () => {
    expect(kwhSince(12.5, 10)).toBe(2.5);
    expect(kwhSince(3, 50)).toBe(0);
    expect(kwhSince(null, 10)).toBeNull();
    expect(kwhSince(12, null)).toBeNull();
    expect(kwhSince(0.1 + 0.2, 0)).toBe(0.3);
  });

  it('energy per bucket differences a cumulative series and sums align on timestamps', () => {
    const cumulative = [
      { ts: 0, value: 10 },
      { ts: 1, value: 10.5 },
      { ts: 2, value: 11.25 },
      { ts: 3, value: 11.2 }, // meter glitch: never negative
    ];
    expect(energyPerBucket(cumulative)).toEqual([
      { ts: 1, value: 0.5 },
      { ts: 2, value: 0.75 },
      { ts: 3, value: 0 },
    ]);
    expect(
      sumSeries([
        [
          { ts: 1, value: 1 },
          { ts: 2, value: 2 },
        ],
        [
          { ts: 2, value: 3 },
          { ts: 3, value: 4 },
        ],
      ]),
    ).toEqual([
      { ts: 1, value: 1 },
      { ts: 2, value: 5 },
      { ts: 3, value: 4 },
    ]);
    expect(meanSeries([[{ ts: 1, value: 0.9 }], [{ ts: 1, value: 0.7 }]])).toEqual([
      { ts: 1, value: 0.8 },
    ]);
  });
});
