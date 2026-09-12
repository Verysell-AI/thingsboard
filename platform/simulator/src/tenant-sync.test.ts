import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Simulation } from './simulation.js';
import { TenantSync } from './tenant-sync.js';
import { loadTenantWorld } from './world.js';
import type { ClientFactory, MqttClientLike } from './mqtt.js';

const datasetsDir = resolve(import.meta.dirname, '../../datasets');
const log = { info: () => undefined, warn: () => undefined, debug: () => undefined };

/** MQTT client that never talks to a broker. */
const fakeClient: ClientFactory = () =>
  ({
    on: () => undefined,
    publish: () => undefined,
    subscribe: () => undefined,
    end: () => undefined,
    connected: false,
  }) as unknown as MqttClientLike;

function makeSim(): Simulation {
  return new Simulation({ mqttUrl: 'mqtt://test', tickMs: 1000, clientFactory: fakeClient, log });
}

function apiAnswering(keys: string[] | number): typeof fetch {
  return (async () =>
    typeof keys === 'number'
      ? new Response('nope', { status: keys })
      : Response.json({ items: keys.map((key) => ({ key })) })) as unknown as typeof fetch;
}

function sync(
  sim: Simulation,
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof TenantSync>[1]> = {},
) {
  return new TenantSync(sim, {
    apiUrl: 'http://api',
    internalToken: 't',
    log,
    pollMs: 60_000,
    loadWorld: (key) => loadTenantWorld(datasetsDir, 'office-demo', key),
    fetchImpl,
    ...extra,
  });
}

describe('TenantSync', () => {
  it('loads the tenants the API lists and drops the ones it no longer lists', async () => {
    const sim = makeSim();
    const s = sync(sim, apiAnswering(['alpha', 'gamma']));
    const first = await s.reconcile((await s.fetchKeys())!);
    expect(first).toEqual({ added: ['alpha', 'gamma'], removed: [] });
    expect(sim.tenantKeys().sort()).toEqual(['alpha', 'gamma']);

    const second = await s.reconcile(['gamma']);
    expect(second).toEqual({ added: [], removed: ['alpha'] });
    expect(sim.tenantKeys()).toEqual(['gamma']);
  });

  it('keeps going when one tenant has no usable dataset', async () => {
    const sim = makeSim();
    const s = sync(sim, apiAnswering([]), {
      loadWorld: (key) => {
        if (key === 'broken') throw new Error('bad dataset');
        return loadTenantWorld(datasetsDir, 'office-demo', key);
      },
    });
    const r = await s.reconcile(['broken', 'beta']);
    expect(r.added).toEqual(['beta']);
    expect(sim.tenantKeys()).toEqual(['beta']);
  });

  it('reports the added tenants once so their clocks can be pulled', async () => {
    const sim = makeSim();
    const onAdded = vi.fn();
    const s = sync(sim, apiAnswering(['alpha']), { onAdded });
    await s.reconcile(['alpha']);
    await s.reconcile(['alpha']);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledWith(['alpha']);
  });

  it('waits for the API at startup instead of failing', async () => {
    const sim = makeSim();
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return Response.json({ items: [{ key: 'beta' }] });
    }) as unknown as typeof fetch;
    const s = sync(sim, flaky, { retryMs: 1, sleep: async () => undefined });
    await s.initial();
    expect(calls).toBe(3);
    expect(sim.tenantKeys()).toEqual(['beta']);
  });

  it('treats an API error as "no change"', async () => {
    const sim = makeSim();
    const s = sync(sim, apiAnswering(500));
    expect(await s.fetchKeys()).toBeNull();
  });
});
