import { describe, expect, it } from 'vitest';
import { liveClock, zonedDateParts, type ClockState } from '@platform/shared/clock';
import { FakeRedis } from '../../lib/redis-fake.js';
import { ReplayService } from '../live/replay.service.js';
import { ClockService } from './clock.service.js';

const TZ = 'Asia/Dubai';
/** 2026-09-07 10:00 Dubai */
const MON_10 = Date.UTC(2026, 8, 7, 6);

function setup(now = MON_10) {
  const clock = { value: now };
  const redis = new FakeRedis(() => clock.value);
  const pushed: { tenantKey: string; state: ClockState }[] = [];
  const sink = {
    async setClock(tenantKey: string, state: ClockState) {
      pushed.push({ tenantKey, state });
    },
  };
  const svc = new ClockService(
    redis,
    new ReplayService(redis, () => clock.value),
    sink,
    TZ,
    () => clock.value,
  );
  return { svc, redis, pushed, clock };
}

describe('ClockService', () => {
  it('defaults to the live clock', async () => {
    const { svc } = setup();
    expect(await svc.getState('alpha')).toEqual(liveClock());
    expect(await svc.now('alpha')).toBe(MON_10);
    expect(await svc.snapshot('alpha')).toMatchObject({
      tenantKey: 'alpha',
      live: true,
      virtualNow: MON_10,
      timeZone: TZ,
    });
  });

  it('applies a command, pushes to the simulator, persists and announces it', async () => {
    const { svc, redis, pushed, clock } = setup();
    const snap = await svc.apply('alpha', { op: 'jumpToTime', time: '20:00', dayOffset: 0 });
    expect(zonedDateParts(snap.virtualNow, TZ)).toMatchObject({ day: 7, hour: 20, minute: 0 });
    expect(snap.live).toBe(false);
    expect(pushed).toEqual([{ tenantKey: 'alpha', state: snap.state }]);
    expect(redis.published).toHaveLength(1);
    const event = JSON.parse(redis.published[0]!.message) as { kind: string; virtualNow: number };
    expect(event.kind).toBe('clock');
    expect(event.virtualNow).toBe(snap.virtualNow);

    // a fresh service instance reads the same state back from Redis and keeps ticking
    const again = new ClockService(
      redis,
      new ReplayService(redis, () => clock.value),
      { setClock: async () => undefined },
      TZ,
      () => clock.value,
    );
    clock.value += 60_000;
    expect(await again.now('alpha')).toBe(snap.virtualNow + 60_000);
    // tenants are independent
    expect(await again.now('beta')).toBe(clock.value);
  });

  it('does not change the clock when the simulator rejects the push', async () => {
    const { svc, redis, clock } = setup();
    const failing = new ClockService(
      redis,
      new ReplayService(redis, () => clock.value),
      {
        setClock: async () => {
          throw new Error('simulator down');
        },
      },
      TZ,
      () => clock.value,
    );
    await expect(failing.apply('alpha', { op: 'speed', speed: 60 })).rejects.toThrow(
      'simulator down',
    );
    expect(await svc.getState('alpha')).toEqual(liveClock());
    expect(redis.published).toHaveLength(0);
  });

  it('speed, jumpBy and reset compose', async () => {
    const { svc, clock } = setup();
    await svc.apply('alpha', { op: 'speed', speed: 60 });
    clock.value += 10_000;
    expect(await svc.now('alpha')).toBe(MON_10 + 600_000);
    await svc.apply('alpha', { op: 'jumpBy', ms: 3_600_000 });
    expect(await svc.now('alpha')).toBe(MON_10 + 600_000 + 3_600_000);
    const reset = await svc.apply('alpha', { op: 'reset' });
    expect(reset.live).toBe(true);
    expect(await svc.now('alpha')).toBe(clock.value);
  });
});
