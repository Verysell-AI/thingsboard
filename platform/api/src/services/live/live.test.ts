import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../../lib/redis-fake.js';
import { LiveStateService } from './live-state.service.js';
import { ReplayService } from './replay.service.js';
import { matchesSubscription } from './live-gateway.js';
import type { LiveEvent } from '@platform/shared/contracts';

describe('LiveStateService', () => {
  it('merges values, tracks online flag and indexes the device', async () => {
    const redis = new FakeRedis();
    const live = new LiveStateService(redis);
    await live.upsert('alpha', 'LIGHT-1.1', {
      values: { state: 1, power_w: 60 },
      ts: 1000,
      online: true,
      deviceType: 'light',
      room: '1.1',
    });
    await live.upsert('alpha', 'LIGHT-1.1', { values: { power_w: 0 }, ts: 900 });
    const s = await live.get('alpha', 'LIGHT-1.1');
    expect(s?.values).toEqual({ state: 1, power_w: 0 });
    expect(s?.ts).toBe(1000); // never moves backwards
    expect(s?.online).toBe(true);
    expect(s?.room).toBe('1.1');
    expect(await live.snapshot('alpha')).toHaveLength(1);
    expect(await live.isEmpty('alpha')).toBe(false);
    expect(await live.isEmpty('beta')).toBe(true);
  });

  it('adds and removes active alarms', async () => {
    const live = new LiveStateService(new FakeRedis());
    await live.upsert('alpha', 'AC-2.3', { alarmAdd: 'AC current high' });
    await live.upsert('alpha', 'AC-2.3', { alarmAdd: 'AC current high' });
    expect((await live.get('alpha', 'AC-2.3'))?.activeAlarms).toEqual(['AC current high']);
    await live.upsert('alpha', 'AC-2.3', { alarmRemove: 'AC current high' });
    expect((await live.get('alpha', 'AC-2.3'))?.activeAlarms).toEqual([]);
  });
});

describe('ReplayService', () => {
  it('assigns stream ids, publishes, and replays only events after lastEventId', async () => {
    let now = 100_000;
    const redis = new FakeRedis(() => now);
    const replay = new ReplayService(redis, () => now);
    const base = {
      tenantKey: 'alpha',
      ts: now,
      kind: 'device.activity' as const,
      deviceCode: 'LAPTOP-E001',
      online: true,
    };
    const e1 = await replay.append('alpha', base);
    now += 10;
    const e2 = await replay.append('alpha', { ...base, online: false });
    now += 10;
    const e3 = await replay.append('alpha', base);
    expect(e1.id).not.toBe(e2.id);
    expect(redis.published.map((p) => p.channel)).toEqual([
      'events:alpha',
      'events:alpha',
      'events:alpha',
    ]);
    const missed = await replay.since('alpha', e1.id);
    expect(missed.map((e) => e.id)).toEqual([e2.id, e3.id]);
    expect(await replay.lastId('alpha')).toBe(e3.id);
  });

  it('trims events older than the replay window', async () => {
    let now = 1_000_000;
    const redis = new FakeRedis(() => now);
    const replay = new ReplayService(redis, () => now);
    const ev = {
      tenantKey: 'alpha',
      ts: now,
      kind: 'device.activity' as const,
      deviceCode: 'X',
      online: true,
    };
    await replay.append('alpha', ev);
    now += 61_000;
    const late = await replay.append('alpha', ev);
    const all = await replay.since('alpha', null);
    expect(all.map((e) => e.id)).toEqual([late.id]);
  });
});

describe('matchesSubscription', () => {
  const ev: LiveEvent = {
    id: '1-0',
    tenantKey: 'alpha',
    ts: 1,
    kind: 'device.telemetry',
    deviceCode: 'RM-1.1',
    room: '1.1',
    values: { power_w: 5 },
  };
  it('passes everything with an empty filter and filters by device, room and kind', () => {
    expect(matchesSubscription(ev, {})).toBe(true);
    expect(matchesSubscription(ev, { devices: ['RM-1.1'] })).toBe(true);
    expect(matchesSubscription(ev, { devices: ['RM-1.2'] })).toBe(false);
    expect(matchesSubscription(ev, { rooms: ['1.1'] })).toBe(true);
    expect(matchesSubscription(ev, { rooms: ['2.1'] })).toBe(false);
    expect(matchesSubscription(ev, { kinds: ['alarm'] })).toBe(false);
  });
});
