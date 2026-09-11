import { describe, expect, it } from 'vitest';
import { acStatus, currentDrift } from './ac-health.service.js';
import { SHARED_DEPARTMENT, allocateRoomDay, monthKeys } from './allocation.service.js';
import { nightStatFrom, standbyVerdict, yearlyKwh } from './standby.service.js';

describe('allocateRoomDay', () => {
  it('splits open plans by desks, meeting rooms by booked minutes, the rest to Shared', () => {
    expect(allocateRoomDay(10, 'open_plan', { Sales: 3, Engineering: 1 }, {})).toEqual({
      Sales: 7.5,
      Engineering: 2.5,
    });
    expect(allocateRoomDay(6, 'meeting', {}, { Finance: 60, Operations: 120 })).toEqual({
      Finance: 2,
      Operations: 4,
    });
    expect(allocateRoomDay(4, 'meeting', {}, {})).toEqual({ [SHARED_DEPARTMENT]: 4 });
    expect(allocateRoomDay(4, 'pantry', { Sales: 3 }, { Sales: 60 })).toEqual({
      [SHARED_DEPARTMENT]: 4,
    });
    expect(allocateRoomDay(0, 'meeting', {}, { Sales: 60 })).toEqual({});
  });
  it('lists the months ending with the current one', () => {
    expect(monthKeys(Date.UTC(2026, 8, 10, 8), 3, 'Asia/Dubai')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(monthKeys(Date.UTC(2026, 0, 15), 2, 'Asia/Dubai')).toEqual(['2025-12', '2026-01']);
  });
});

describe('standby', () => {
  it('summarises a night and flags devices idling in the standby band on most nights', () => {
    expect(nightStatFrom([6, 6, 6, 6, 0, NaN])).toEqual({ avgNightPowerW: 4.8, hoursAbove5w: 1 });
    expect(nightStatFrom([])).toBeNull();
    const idle = { avgNightPowerW: 6.2, hoursAbove5w: 8 };
    const off = { avgNightPowerW: 0.4, hoursAbove5w: 0 };
    const busy = { avgNightPowerW: 400, hoursAbove5w: 8 };
    expect(standbyVerdict([idle, idle, idle, idle, idle, off, off])).toEqual({
      flagged: true,
      nightsFlagged: 5,
    });
    expect(standbyVerdict([idle, idle, idle, idle, off, off, off])).toEqual({
      flagged: false,
      nightsFlagged: 4,
    });
    expect(standbyVerdict([busy, busy, busy, busy, busy, busy, busy])).toEqual({
      flagged: false,
      nightsFlagged: 0,
    });
    expect(
      standbyVerdict([{ avgNightPowerW: 20, hoursAbove5w: 3 }, idle, idle, idle, idle, idle]),
    ).toEqual({ flagged: true, nightsFlagged: 5 });
    expect(yearlyKwh(6)).toBe(17.5);
  });
});

describe('ac health', () => {
  it('measures the drift of current per watt against two weeks ago and ranks the status', () => {
    // same output, 27 % more current
    expect(
      currentDrift({ currentA: 4.32, powerW: 800 }, { currentA: 3.4, powerW: 800 }),
    ).toBeCloseTo(0.271, 3);
    // a different duty cycle alone is not drift
    expect(currentDrift({ currentA: 1.7, powerW: 400 }, { currentA: 3.4, powerW: 800 })).toBe(0);
    expect(
      currentDrift({ currentA: null, powerW: 800 }, { currentA: 3.4, powerW: 800 }),
    ).toBeNull();
    expect(currentDrift({ currentA: 3.4, powerW: 800 }, { currentA: 0.1, powerW: 20 })).toBeNull();
    expect(acStatus(true, 0)).toBe('alarm');
    expect(acStatus(false, 0.27)).toBe('watch');
    expect(acStatus(false, 0.05)).toBe('healthy');
    expect(acStatus(false, null)).toBe('healthy');
  });
});
