import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../../lib/redis-fake.js';
import type { TbTimeseries } from '../tb/tb.client.js';
import { HISTORY_MAX_POINTS, HistoryService, toSeries } from './history.service.js';

const NOW = Date.UTC(2026, 8, 7, 8);
const DAY = 24 * 3_600_000;

describe('HistoryService.normalise', () => {
  it('defaults to the last 24 hours at 15-minute average', () => {
    const r = HistoryService.normalise({ keys: 'power_w, pf' }, NOW);
    expect(r).toEqual({
      keys: ['power_w', 'pf'],
      from: NOW - DAY,
      to: NOW,
      interval: 15 * 60_000,
      agg: 'AVG',
    });
  });

  it('caps the range at 35 days and the point count at 5000', () => {
    expect(() =>
      HistoryService.normalise({ keys: 'a', from: NOW - 40 * DAY, to: NOW }, NOW),
    ).toThrow(/35 days/);
    const r = HistoryService.normalise(
      { keys: 'a', from: NOW - 30 * DAY, to: NOW, interval: 60_000 },
      NOW,
    );
    expect((30 * DAY) / r.interval).toBeLessThanOrEqual(HISTORY_MAX_POINTS);
    expect(() => HistoryService.normalise({ keys: 'a', from: NOW, to: NOW }, NOW)).toThrow();
    expect(() => HistoryService.normalise({ keys: ' ' }, NOW)).toThrow(/keys/);
  });
});

describe('HistoryService.series', () => {
  function setup() {
    let clock = NOW;
    const redis = new FakeRedis(() => clock);
    const calls: unknown[] = [];
    const tb = {
      forTenant: () => ({
        getTimeseries: async (_id: string, params: unknown): Promise<TbTimeseries> => {
          calls.push(params);
          return {
            power_w: [
              { ts: NOW - 900_000, value: '900.5' },
              { ts: NOW - 1_800_000, value: '800' },
              { ts: NOW - 600_000, value: 'not a number' },
            ],
          };
        },
      }),
    };
    const svc = new HistoryService(tb, redis, 30);
    return { svc, calls, advance: (ms: number) => (clock += ms) };
  }

  it('proxies ThingsBoard, sorts and cleans points, and caches for 30 s', async () => {
    const { svc, calls, advance } = setup();
    const req = HistoryService.normalise({ keys: 'power_w' }, NOW);
    const first = await svc.series('alpha', 'dev-1', 'RM-1.1', req);
    expect(first.deviceCode).toBe('RM-1.1');
    expect(first.series.power_w).toEqual([
      { ts: NOW - 1_800_000, value: 800 },
      { ts: NOW - 900_000, value: 900.5 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ interval: 900_000, agg: 'AVG', limit: HISTORY_MAX_POINTS });
    await svc.series('alpha', 'dev-1', 'RM-1.1', req);
    expect(calls).toHaveLength(1);
    advance(31_000);
    await svc.series('alpha', 'dev-1', 'RM-1.1', req);
    expect(calls).toHaveLength(2);
    // a different tenant or device never shares a cache entry
    await svc.series('beta', 'dev-1', 'RM-1.1', req);
    expect(calls).toHaveLength(3);
  });

  it('aggregate returns the single bucket value or null', async () => {
    const { svc } = setup();
    expect(await svc.aggregate('alpha', 'dev-1', 'power_w', NOW - DAY, NOW, 'MIN')).toBe(800);
    expect(await svc.aggregate('alpha', 'dev-1', 'power_w', NOW, NOW, 'MIN')).toBeNull();
  });

  it('toSeries keeps requested keys even when ThingsBoard omits them', () => {
    expect(toSeries({}, ['a', 'b'])).toEqual({ a: [], b: [] });
  });
});
