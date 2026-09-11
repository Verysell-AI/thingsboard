import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { liveClock } from '@platform/shared/clock';
import { buildControlApp } from '../src/control.js';
import { buildSimulation, monday } from './helpers.js';

const token = 'test-token';
const headers = { 'x-internal-token': token };

describe('control API', () => {
  let app: FastifyInstance;
  const now = { value: monday(10) };
  const { sim, registry } = buildSimulation(now);

  beforeAll(async () => {
    app = buildControlApp(sim, { internalToken: token, defaultTenant: 'alpha' });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    sim.stop();
  });

  it('health is open, everything else needs the internal token', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/state' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/state', headers: { 'x-internal-token': 'wrong' } }))
        .statusCode,
    ).toBe(401);
  });

  it('GET /state lists every device with its room', async () => {
    const res = await app.inject({ method: 'GET', url: '/state', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clocks).toEqual({ alpha: liveClock() });
    expect(body.timeZone).toBe('Asia/Dubai');
    expect(body.devices.length).toBe(registry.all().length);
    expect(body.devices.find((d: { code: string }) => d.code === 'LIGHT-1.1').room).toBe('1.1');
  });

  it('every scenario answers 200, unknown ones 404, bad params 400', async () => {
    const ghost = await app.inject({
      method: 'POST',
      url: '/scenario/ghost-meeting',
      headers,
      payload: { room: '1.4' },
    });
    expect(ghost.statusCode).toBe(200);
    expect(ghost.json()).toMatchObject({ scenario: 'ghost-meeting', accepted: true });
    expect(
      (await app.inject({ method: 'POST', url: '/scenario/unknown', headers, payload: {} }))
        .statusCode,
    ).toBe(404);
    const ok = await app.inject({
      method: 'POST',
      url: '/scenario/lunch-peak?tenant=alpha',
      headers,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accepted).toBe(true);
    const bad = await app.inject({
      method: 'POST',
      url: '/scenario/new-laptop-first-boot',
      headers,
      payload: { code: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/scenario/lunch-peak?tenant=zeta',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it('adds and removes runtime devices', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/devices',
      headers,
      payload: {
        tenant: 'alpha',
        code: 'LAPTOP-E999',
        type: 'laptop',
        accessToken: 'alpha-LAPTOP-E999',
        attrs: { room: '2.O', user: 'new.hire' },
      },
    });
    expect(created.statusCode).toBe(201);
    const laptop = registry.get('LAPTOP-E999')!;
    expect(laptop.shouldBeOnline(now.value)).toBe(false);
    expect(laptop.spec.laptop?.homeAccessPoint).toBe('AP-2W');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/devices',
          headers,
          payload: { tenant: 'alpha', code: 'LAPTOP-E999', type: 'laptop', accessToken: 'x' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: 'DELETE', url: '/devices/LAPTOP-E999', headers })).statusCode,
    ).toBe(204);
    expect(registry.get('LAPTOP-E999')).toBeUndefined();
    expect(
      (await app.inject({ method: 'DELETE', url: '/devices/LAPTOP-E999', headers })).statusCode,
    ).toBe(404);
  });

  it('PUT /clock sets a tenant business clock and GET /clock reads it back', async () => {
    const state = { anchorRealMs: now.value, anchorVirtualMs: monday(20), speed: 10 };
    const put = await app.inject({
      method: 'PUT',
      url: '/clock',
      headers,
      payload: { tenant: 'alpha', state },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      tenantKey: 'alpha',
      state,
      virtualNow: monday(20),
      live: false,
      timeZone: 'Asia/Dubai',
    });
    const get = await app.inject({ method: 'GET', url: '/clock?tenant=alpha', headers });
    expect(get.json().state).toEqual(state);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/clock',
          headers,
          payload: { tenant: 'zeta', state },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/clock',
          headers,
          payload: { tenant: 'alpha', state: { ...state, speed: 9999 } },
        })
      ).statusCode,
    ).toBe(400);
    sim.setClock('alpha', liveClock());
  });
});
