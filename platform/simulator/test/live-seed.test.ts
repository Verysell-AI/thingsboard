import { describe, expect, it } from 'vitest';
import { seedFromLiveState } from '../src/live-seed.js';
import { buildSimulation, monday, silentLog } from './helpers.js';

describe('seeding counters from the platform live state', () => {
  it('continues energy and runtime counters and ignores unknown or invalid values', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    const snapshot = {
      tenantKey: 'alpha',
      lastEventId: null,
      devices: [
        {
          deviceCode: 'RM-1.1',
          deviceType: 'room_meter',
          tbDeviceId: null,
          room: '1.1',
          online: true,
          ts: 1,
          values: { energy_kwh: 123.456, power_w: 400 },
          activeAlarms: [],
        },
        {
          deviceCode: 'PLUG-1.P-FRIDGE',
          deviceType: 'plug',
          tbDeviceId: null,
          room: '1.P',
          online: true,
          ts: 1,
          values: { energy_kwh: '7.5' },
          activeAlarms: [],
        },
        {
          deviceCode: 'AC-2.3',
          deviceType: 'ac',
          tbDeviceId: null,
          room: '2.3',
          online: true,
          ts: 1,
          values: { runtime_h: 812.4, current_a: 4.9 },
          activeAlarms: [],
        },
        {
          deviceCode: 'LIGHT-1.1',
          deviceType: 'light',
          tbDeviceId: null,
          room: '1.1',
          online: true,
          ts: 1,
          values: { energy_kwh: 1 },
          activeAlarms: [],
        },
        {
          deviceCode: 'RM-1.2',
          deviceType: 'room_meter',
          tbDeviceId: null,
          room: '1.2',
          online: true,
          ts: 1,
          values: { energy_kwh: 'n/a' },
          activeAlarms: [],
        },
        {
          deviceCode: 'NOPE',
          deviceType: 'plug',
          tbDeviceId: null,
          room: null,
          online: false,
          ts: null,
          values: { energy_kwh: 1 },
          activeAlarms: [],
        },
      ],
    };
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }) as typeof fetch;
    const seeded = await seedFromLiveState(sim, {
      apiUrl: 'http://api.test/',
      internalToken: 't',
      log: silentLog,
      fetchImpl,
    });
    expect(seeded).toBe(3);
    expect(calls).toEqual(['http://api.test/internal/live/alpha']);
    await sim.start();
    now.value += 10_000;
    sim.tick();
    expect(Number(registry.get('RM-1.1')!.values.energy_kwh)).toBeGreaterThan(123.456);
    expect(Number(registry.get('PLUG-1.P-FRIDGE')!.values.energy_kwh)).toBeGreaterThanOrEqual(7.5);
    expect(Number(registry.get('AC-2.3')!.values.runtime_h)).toBeGreaterThan(812);
    expect(Number(registry.get('RM-1.2')!.values.energy_kwh)).toBeLessThan(1);
    sim.stop();
  });

  it('keeps initial state when the API is unreachable', async () => {
    const { sim } = buildSimulation({ value: monday(10) });
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(
      await seedFromLiveState(sim, {
        apiUrl: 'http://api.test',
        internalToken: 't',
        log: silentLog,
        fetchImpl,
      }),
    ).toBe(0);
  });
});
