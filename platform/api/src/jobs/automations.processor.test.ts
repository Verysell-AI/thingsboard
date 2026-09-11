import { describe, expect, it } from 'vitest';
import {
  MIN_FAST_TICK_MS,
  enqueueTick,
  tickIntervalMs,
  type AutomationQueue,
} from './automations.processor.js';

describe('tick scheduling', () => {
  it('ticks every minute at real speed and faster while the business clock runs fast', () => {
    expect(tickIntervalMs(1, 60_000)).toBe(60_000);
    expect(tickIntervalMs(0, 60_000)).toBe(60_000);
    expect(tickIntervalMs(2, 60_000)).toBe(30_000);
    expect(tickIntervalMs(60, 60_000)).toBe(MIN_FAST_TICK_MS);
    expect(tickIntervalMs(600, 60_000)).toBe(MIN_FAST_TICK_MS);
  });

  it('enqueues an immediate tick with a per-second job id so bursts collapse', async () => {
    const added: { name: string; data: unknown; opts: unknown }[] = [];
    const queue: AutomationQueue = {
      add: async (name, data, opts) => {
        added.push({ name, data, opts });
      },
    };
    const realNow = () => 1_800_000_000_500;
    await enqueueTick(queue, { id: 't1', key: 'alpha' }, 'clock', 0, realNow);
    await enqueueTick(queue, { id: 't1', key: 'alpha' }, 'fast', 5_000, realNow);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({
      name: 'tick',
      data: { tenantKey: 'alpha', kind: 'tick', trigger: 'clock' },
      opts: { jobId: 'clock:alpha:1800000000', delay: 0 },
    });
    expect(added[1]!.opts).toMatchObject({ jobId: 'fast:alpha:1800000005', delay: 5_000 });
  });
});
