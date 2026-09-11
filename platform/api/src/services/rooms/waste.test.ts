import { describe, expect, it } from 'vitest';
import type { RoomPresence } from './presence.service.js';
import { WASTE_IDLE_MS, dayKey, isWasting, wasteIncrementKwh } from './waste.service.js';

const NOW = Date.UTC(2026, 8, 7, 8, 0);
const presence = (over: Partial<RoomPresence>): RoomPresence => ({
  room: '1.1',
  occupied: false,
  sensorOccupied: false,
  count: 0,
  laptopsOnline: 0,
  laptopCodes: [],
  emptySince: NOW - WASTE_IDLE_MS,
  updatedAt: NOW,
  ...over,
});

describe('waste', () => {
  it('is wasting only when empty for ten minutes with lights or AC on', () => {
    expect(isWasting(presence({}), true, false, NOW)).toBe(true);
    expect(isWasting(presence({}), false, true, NOW)).toBe(true);
    expect(isWasting(presence({}), false, false, NOW)).toBe(false);
    expect(isWasting(presence({ emptySince: NOW - WASTE_IDLE_MS + 1000 }), true, true, NOW)).toBe(
      false,
    );
    expect(isWasting(presence({ occupied: true, emptySince: null }), true, true, NOW)).toBe(false);
    expect(isWasting(undefined, true, true, NOW)).toBe(false);
  });

  it('integrates power above the base load, capped per step', () => {
    // 615 W for ten minutes: 600 W excess → 0.1 kWh
    expect(wasteIncrementKwh(615, 600_000)).toBeCloseTo(0.1, 6);
    // any longer gap (an hour, a time-machine jump of 3 hours) counts as 15 minutes
    expect(wasteIncrementKwh(615, 3_600_000)).toBeCloseTo(0.15, 6);
    expect(wasteIncrementKwh(615, 3 * 3_600_000)).toBeCloseTo(0.15, 6);
    expect(wasteIncrementKwh(10, 3_600_000)).toBe(0);
    expect(wasteIncrementKwh(null, 3_600_000)).toBe(0);
  });

  it('keys days by the business zone', () => {
    // 22:30 UTC on the 7th is already the 8th in Dubai
    expect(dayKey(Date.UTC(2026, 8, 7, 22, 30), 'Asia/Dubai')).toBe('2026-09-08');
    expect(dayKey(Date.UTC(2026, 8, 7, 22, 30), 'UTC')).toBe('2026-09-07');
  });
});
