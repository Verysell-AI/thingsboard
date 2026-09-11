import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '@platform/shared/contracts';
import { SWEEP_BANNER_MS, sweepBannerFrom } from '~/components/sweep-banner';
import { holdUntil } from '~/components/holds-card';

const NOW = 1_800_000_000_000;
function run(over: Partial<Extract<LiveEvent, { kind: 'automation.run' }>>): LiveEvent {
  return {
    id: '1-0',
    kind: 'automation.run',
    tenantKey: 'alpha',
    ts: NOW,
    automationKey: 'evening_sweep',
    runId: '00000000-0000-4000-8000-000000000001',
    status: 'finished',
    ...over,
  } as LiveEvent;
}

describe('sweepBannerFrom', () => {
  it('announces a running sweep, then its outcome, and forgets it after a while', () => {
    expect(sweepBannerFrom([run({ status: 'started' })], NOW)).toEqual({
      status: 'started',
      roomsOff: 0,
      roomsKept: 0,
      estimatedKwhSaved: null,
    });
    const finished = run({
      summary: {
        roomsOff: ['1.1', '1.2'],
        roomsSkipped: [{ room: '1.O', reason: 'laptop_online' }],
        estimatedKwhSaved: 6.6,
      },
    });
    expect(sweepBannerFrom([finished], NOW + 1000)).toEqual({
      status: 'finished',
      roomsOff: 2,
      roomsKept: 1,
      estimatedKwhSaved: 6.6,
    });
    expect(sweepBannerFrom([finished], NOW + SWEEP_BANNER_MS + 1)).toBeNull();
  });

  it('ignores "not due" runs and other automations', () => {
    expect(sweepBannerFrom([run({ summary: { roomsOff: [], roomsSkipped: [] } })], NOW)).toBeNull();
    expect(
      sweepBannerFrom(
        [run({ automationKey: 'room_auto_off', summary: { roomsOff: ['1.1'] } })],
        NOW,
      ),
    ).toBeNull();
    expect(sweepBannerFrom([], NOW)).toBeNull();
  });
});

describe('holdUntil', () => {
  it('picks today’s time in the tenant zone, or tomorrow’s when it has passed', () => {
    const noon = Date.UTC(2026, 8, 7, 8, 0); // 12:00 Dubai
    expect(holdUntil(noon, '23:00', 'Asia/Dubai')).toBe(Date.UTC(2026, 8, 7, 19, 0));
    expect(holdUntil(noon, '09:00', 'Asia/Dubai')).toBe(Date.UTC(2026, 8, 8, 5, 0));
  });
});
