import { describe, expect, it } from 'vitest';
import { previousMonth } from './reports.service.js';
import { mean, nightKwhFrom } from './savings.service.js';

const TZ = 'Asia/Dubai';
// Monday 2026-09-07 in Dubai; 20:00 local = 16:00 UTC
const MON_20 = Date.UTC(2026, 8, 7, 16, 0);
const H = 3_600_000;

describe('nightKwhFrom', () => {
  it('sums hourly average power from 20:00 to 07:00 into the evening’s date, weekday nights only', () => {
    const points = [];
    for (let i = 0; i < 24; i++) points.push({ ts: MON_20 - 4 * H + i * H, value: 1000 }); // 16:00 Mon → 15:00 Tue
    const nights = nightKwhFrom(points, TZ);
    // 20:00..06:00 = 11 hourly points of 1 kW → 11 kWh on Monday's night
    expect(nights.get('2026-09-07')).toBe(11);
    expect(nights.has('2026-09-06')).toBe(false);
    // Friday 20:00 is a weekday night, Saturday 20:00 is not
    const fri = Date.UTC(2026, 8, 11, 16, 0);
    const sat = Date.UTC(2026, 8, 12, 16, 0);
    expect(nightKwhFrom([{ ts: fri, value: 500 }], TZ).get('2026-09-11')).toBe(0.5);
    expect(nightKwhFrom([{ ts: sat, value: 500 }], TZ).size).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(mean([])).toBe(0);
  });
});

describe('previousMonth', () => {
  it('names the month before the current one', () => {
    expect(previousMonth(Date.UTC(2026, 8, 1, 8), TZ)).toBe('2026-08');
    expect(previousMonth(Date.UTC(2026, 0, 1, 8), TZ)).toBe('2025-12');
  });
});
