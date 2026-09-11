import { describe, expect, it } from 'vitest';
import { clockTimeInputValue, formatClockDate, formatClockTime } from '~/lib/clock';
import { initialLiveState, liveReducer } from '~/lib/live-store';

/** 2026-09-07 20:00 in Dubai is 16:00 UTC. */
const MON_20 = Date.UTC(2026, 8, 7, 16, 0, 5);

describe('clock formatting', () => {
  it('formats the business time in the tenant zone, not the browser zone', () => {
    expect(formatClockTime(MON_20, 'Asia/Dubai', 'en')).toBe('20:00:05');
    expect(formatClockTime(MON_20, 'Asia/Dubai', 'en', { seconds: false })).toBe('20:00');
    expect(formatClockTime(MON_20, 'UTC', 'en')).toBe('16:00:05');
    expect(formatClockDate(MON_20, 'Asia/Dubai', 'en')).toMatch(/Mon.*7.*Sep|Sep.*7/);
    expect(clockTimeInputValue(MON_20, 'Asia/Dubai')).toBe('20:00');
    expect(clockTimeInputValue(MON_20, 'Asia/Ho_Chi_Minh')).toBe('23:00');
  });
});

describe('liveReducer clock events', () => {
  it('keeps the latest clock event and lists it in the event log', () => {
    const state = liveReducer(initialLiveState, {
      type: 'event',
      event: {
        id: '9-0',
        tenantKey: 'alpha',
        ts: MON_20,
        kind: 'clock',
        state: { anchorRealMs: MON_20, anchorVirtualMs: MON_20 + 3_600_000, speed: 60 },
        virtualNow: MON_20 + 3_600_000,
        timeZone: 'Asia/Dubai',
      },
    });
    expect(state.clock?.state.speed).toBe(60);
    expect(state.lastEventId).toBe('9-0');
    expect(state.events[0]?.kind).toBe('clock');
    expect(Object.keys(state.devices)).toHaveLength(0);
  });
});
