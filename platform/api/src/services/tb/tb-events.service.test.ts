import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../../lib/redis-fake.js';
import { LiveStateService } from '../live/live-state.service.js';
import { ReplayService } from '../live/replay.service.js';
import { TbEventsService, type DeviceLookup, type TbEventHooks } from './tb-events.service.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const lookup: DeviceLookup = {
  tenantId: 't',
  tenantKey: 'alpha',
  assetId: 'a',
  deviceCode: 'AC-2.3',
  deviceType: 'ac',
  room: '2.3',
};

const LAPTOP_ID = '33333333-3333-4333-8333-333333333333';
const laptop: DeviceLookup = {
  ...lookup,
  deviceCode: 'LAPTOP-E001',
  deviceType: 'laptop',
  room: '1.O',
};
const resolverWithLaptop = {
  byTbDeviceId: async (id: string) =>
    id === DEVICE_ID ? lookup : id === LAPTOP_ID ? laptop : null,
};

function setup(now = 1_000_000) {
  const redis = new FakeRedis(() => now);
  const live = new LiveStateService(redis);
  const replay = new ReplayService(redis, () => now);
  const calls: string[] = [];
  const hooks: TbEventHooks = {
    onInactivity: async (d) => void calls.push(`inactivity:${d.deviceCode}`),
    onActivity: async (d) => void calls.push(`activity:${d.deviceCode}`),
    onAlarm: async (d, a) => void calls.push(`alarm:${d.deviceCode}:${a.type}:${a.status}`),
  };
  const svc = new TbEventsService(resolverWithLaptop, live, replay, () => now, hooks);
  return { redis, live, svc, calls };
}

const originator = { id: DEVICE_ID, entityType: 'DEVICE' as const, name: 'AC-2.3', type: 'ac' };

describe('TbEventsService', () => {
  it('ignores unknown devices', async () => {
    const { svc } = setup();
    const r = await svc.handle({
      type: 'telemetry',
      originator: { ...originator, id: '22222222-2222-4222-8222-222222222222' },
      ts: 1_000_000,
      data: { power_w: 1 },
      metadata: {},
    });
    expect(r).toEqual({ outcome: 'ignored', reason: 'unknown-device' });
  });

  it('drops telemetry older than five minutes but keeps fresh telemetry', async () => {
    const { svc, live, redis } = setup();
    const stale = await svc.handle({
      type: 'telemetry',
      originator,
      ts: 1_000_000 - 6 * 60_000,
      data: { power_w: 900 },
      metadata: {},
    });
    expect(stale).toEqual({ outcome: 'ignored', reason: 'stale' });
    const fresh = await svc.handle({
      type: 'telemetry',
      originator,
      ts: 1_000_000 - 1000,
      data: { power_w: 900, current_a: 4.3, label: 'x', nested: { a: 1 } },
      metadata: {},
    });
    expect(fresh.outcome).toBe('accepted');
    const state = await live.get('alpha', 'AC-2.3');
    expect(state?.values).toEqual({ power_w: 900, current_a: 4.3, label: 'x' });
    expect(state?.online).toBe(true);
    expect(state?.room).toBe('2.3');
    expect(redis.published).toHaveLength(1);
    const ev = JSON.parse(redis.published[0]!.message);
    expect(ev.kind).toBe('device.telemetry');
    expect(ev.deviceCode).toBe('AC-2.3');
    expect(ev.id).toMatch(/^\d+-\d+$/);
  });

  it('maps activity events to online flags', async () => {
    const { svc, live } = setup();
    await svc.handle({
      type: 'inactivity',
      originator,
      ts: 1_000_000,
      data: { active: false },
      metadata: {},
    });
    expect((await live.get('alpha', 'AC-2.3'))?.online).toBe(false);
    const r = await svc.handle({
      type: 'activity',
      originator,
      ts: 1_000_000,
      data: { active: true },
      metadata: {},
    });
    expect((await live.get('alpha', 'AC-2.3'))?.online).toBe(true);
    expect(r.outcome === 'accepted' && r.event.kind === 'device.activity' && r.event.online).toBe(
      true,
    );
  });

  it('maps alarm created/cleared to alarm events and active alarm list', async () => {
    const { svc, live } = setup();
    const created = await svc.handle({
      type: 'alarm_created',
      originator,
      ts: 1_000_000,
      data: {
        type: 'AC current high',
        severity: 'MAJOR',
        status: 'ACTIVE_UNACK',
        id: { id: 'alarm-1', entityType: 'ALARM' },
      },
      metadata: {},
    });
    expect(
      created.outcome === 'accepted' && created.event.kind === 'alarm' && created.event,
    ).toMatchObject({
      alarmType: 'AC current high',
      severity: 'MAJOR',
      status: 'created',
      tbAlarmId: 'alarm-1',
    });
    expect((await live.get('alpha', 'AC-2.3'))?.activeAlarms).toEqual(['AC current high']);
    const cleared = await svc.handle({
      type: 'alarm_cleared',
      originator,
      ts: 1_000_001,
      data: { type: 'AC current high', severity: 'weird' },
      metadata: {},
    });
    expect(
      cleared.outcome === 'accepted' && cleared.event.kind === 'alarm' && cleared.event.severity,
    ).toBe('INDETERMINATE');
    expect((await live.get('alpha', 'AC-2.3'))?.activeAlarms).toEqual([]);
  });

  it('a silent laptop becomes an unreachable asset and the hooks are told', async () => {
    const { svc, live, redis, calls } = setup();
    const laptopOriginator = { id: LAPTOP_ID, entityType: 'DEVICE' as const, name: 'LAPTOP-E001' };
    await svc.handle({
      type: 'inactivity',
      originator: laptopOriginator,
      ts: 1_000_000,
      data: { active: false },
      metadata: {},
    });
    const state = await live.get('alpha', 'LAPTOP-E001');
    expect(state?.online).toBe(false);
    expect(state?.activeAlarms).toEqual(['Asset unreachable']);
    const kinds = redis.published.map((p) => (JSON.parse(p.message) as { kind: string }).kind);
    expect(kinds).toEqual(['device.activity', 'alarm']);
    expect(calls).toEqual(['inactivity:LAPTOP-E001']);

    await svc.handle({
      type: 'activity',
      originator: laptopOriginator,
      ts: 1_000_001,
      data: { active: true },
      metadata: {},
    });
    expect((await live.get('alpha', 'LAPTOP-E001'))?.activeAlarms).toEqual([]);
    expect(calls).toEqual(['inactivity:LAPTOP-E001', 'activity:LAPTOP-E001']);

    // other device types going silent are just offline; the hook still hears about it
    await svc.handle({ type: 'inactivity', originator, ts: 1_000_002, data: {}, metadata: {} });
    expect((await live.get('alpha', 'AC-2.3'))?.activeAlarms).toEqual([]);
    expect(calls).toEqual(['inactivity:LAPTOP-E001', 'activity:LAPTOP-E001', 'inactivity:AC-2.3']);
  });

  it('alarm hooks receive created and cleared alarms', async () => {
    const { svc, calls } = setup();
    await svc.handle({
      type: 'alarm_created',
      originator,
      ts: 1,
      data: { type: 'AC current high', severity: 'MAJOR' },
      metadata: {},
    });
    await svc.handle({
      type: 'alarm_cleared',
      originator,
      ts: 2,
      data: { type: 'AC current high', severity: 'MAJOR' },
      metadata: {},
    });
    expect(calls).toEqual([
      'alarm:AC-2.3:AC current high:created',
      'alarm:AC-2.3:AC current high:cleared',
    ]);
  });
});
