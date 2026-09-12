import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import { buildControlApp } from './control.js';
import { Simulation } from './simulation.js';
import { loadTenantWorld } from './world.js';
import type { ClientFactory, MqttClientLike } from './mqtt.js';

const datasetsDir = resolve(import.meta.dirname, '../../datasets');
const log = { info: () => undefined, warn: () => undefined, debug: () => undefined };
const fakeClient: ClientFactory = () =>
  ({
    on: () => undefined,
    publish: () => undefined,
    subscribe: () => undefined,
    end: () => undefined,
    connected: false,
  }) as unknown as MqttClientLike;
const headers = { [INTERNAL_TOKEN_HEADER]: 'secret' };

describe('control API: tenants', () => {
  const sim = new Simulation({
    mqttUrl: 'mqtt://test',
    tickMs: 1000,
    clientFactory: fakeClient,
    log,
  });
  const app = buildControlApp(sim, {
    internalToken: 'secret',
    loadWorld: (key) => loadTenantWorld(datasetsDir, 'office-demo', key),
  });
  afterEach(() => sim.stop());

  it('loads a tenant on PUT and reports its device count', async () => {
    const res = await app.inject({ method: 'PUT', url: '/tenants/gamma', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: 'gamma' });
    expect(res.json().devices).toBeGreaterThan(50);
    expect(sim.tenantKeys()).toContain('gamma');
    // a second PUT reloads instead of duplicating
    const again = await app.inject({ method: 'PUT', url: '/tenants/gamma', headers });
    expect(again.statusCode).toBe(200);
    expect(sim.tenantKeys().filter((k) => k === 'gamma')).toHaveLength(1);
  });

  it('removes a tenant on DELETE and answers 404 for an unknown one', async () => {
    await app.inject({ method: 'PUT', url: '/tenants/alpha', headers });
    const res = await app.inject({ method: 'DELETE', url: '/tenants/alpha', headers });
    expect(res.statusCode).toBe(204);
    expect(sim.tenantKeys()).not.toContain('alpha');
    const missing = await app.inject({ method: 'DELETE', url: '/tenants/alpha', headers });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects requests without the internal token', async () => {
    const res = await app.inject({ method: 'PUT', url: '/tenants/beta' });
    expect(res.statusCode).toBe(401);
  });
});
