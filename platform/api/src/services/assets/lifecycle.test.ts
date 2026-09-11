import { describe, expect, it } from 'vitest';
import { annualDepreciation, daysUntil, endOfLifeDate } from './depreciation.service.js';
import { fleetFlags } from './fleet.service.js';

const NOW = Date.UTC(2026, 8, 10, 8, 0);
const DAY = 24 * 3_600_000;

describe('fleetFlags', () => {
  const healthy = {
    batteryHealthPct: 85,
    online: true,
    lastOnlineAt: NOW,
    warrantyEnd: '2028-01-01',
    misplaced: false,
  };
  it('flags worn batteries, laptops gone for a month, expiring warranties and misplacement', () => {
    expect(fleetFlags(healthy, NOW)).toEqual([]);
    expect(fleetFlags({ ...healthy, batteryHealthPct: 55 }, NOW)).toEqual(['replace_soon']);
    expect(fleetFlags({ ...healthy, online: false, lastOnlineAt: NOW - 31 * DAY }, NOW)).toEqual([
      'reclaim',
    ]);
    expect(fleetFlags({ ...healthy, online: false, lastOnlineAt: NOW - 3 * DAY }, NOW)).toEqual([]);
    expect(fleetFlags({ ...healthy, online: false, lastOnlineAt: null }, NOW)).toEqual(['reclaim']);
    expect(fleetFlags({ ...healthy, warrantyEnd: '2026-11-01' }, NOW)).toEqual([
      'warranty_expiring',
    ]);
    expect(fleetFlags({ ...healthy, warrantyEnd: '2026-01-01' }, NOW)).toEqual([]);
    expect(fleetFlags({ ...healthy, misplaced: true, batteryHealthPct: null }, NOW)).toEqual([
      'misplaced',
    ]);
  });
});

describe('depreciation', () => {
  it('computes yearly straight-line depreciation and the end of life', () => {
    expect(annualDepreciation(2400, 10)).toBe(240);
    expect(annualDepreciation(null, 10)).toBeNull();
    expect(annualDepreciation(100, null)).toBeNull();
    expect(endOfLifeDate('2023-03-15', 4)).toBe('2027-03-15');
    expect(endOfLifeDate(null, 4)).toBeNull();
    expect(daysUntil('2026-09-20', NOW, 'Asia/Dubai')).toBe(10);
    expect(daysUntil('2026-09-01', NOW, 'Asia/Dubai')).toBe(-9);
  });
});
