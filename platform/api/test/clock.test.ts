import { io as ioClient, type Socket } from 'socket.io-client';
import { MockAgent } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_SOCKET, type LiveEvent } from '@platform/shared/contracts';
import { zonedDateParts, type ClockSnapshot, type ClockState } from '@platform/shared/clock';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping clock tests');

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe.skipIf(!integrationEnabled)('business clock / time machine (integration)', () => {
  let t: TestApp;
  let baseUrl: string;
  const pushed: { tenant: string; state: ClockState }[] = [];
  let simulatorDown = false;

  beforeAll(async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent
      .get('http://simulator.test:4100')
      .intercept({ path: '/clock', method: 'PUT' })
      .reply((opts) => {
        if (simulatorDown) return { statusCode: 503, data: { message: 'down' } };
        const body = JSON.parse(String(opts.body)) as { tenant: string; state: ClockState };
        pushed.push(body);
        return { statusCode: 200, data: { ok: true } };
      })
      .persist();
    t = await buildTestApp({ simulatorDispatcher: agent });
    await t.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = t.fastify.server.address();
    baseUrl =
      typeof address === 'object' && address
        ? `http://127.0.0.1:${address.port}`
        : 'http://127.0.0.1';
  });
  afterAll(async () => {
    await t?.close();
  });

  it('is readable by any user of a demo tenant and invisible outside demo mode', async () => {
    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    const res = await t.fastify.inject({
      method: 'GET',
      url: '/clock',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${viewer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tenantKey: 'alpha', live: true, timeZone: 'Asia/Dubai' });

    const beta = await login(t, 'beta.localhost', 'admin@beta.demo');
    const hidden = await t.fastify.inject({
      method: 'GET',
      url: '/clock',
      headers: { host: 'beta.localhost', authorization: `Bearer ${beta}` },
    });
    expect(hidden.statusCode).toBe(404);

    const me = await t.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${viewer}` },
    });
    expect(me.json().tenant.timeZone).toBe('Asia/Dubai');
  });

  it('only tenant admins move the clock; a jump is pushed to the simulator and announced live', async () => {
    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    const denied = await t.fastify.inject({
      method: 'POST',
      url: '/clock',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${viewer}` },
      payload: { op: 'jumpBy', ms: 600_000 },
    });
    expect(denied.statusCode).toBe(403);

    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const socket = ioClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { [LIVE_SOCKET.authToken]: admin },
    });
    await waitFor(socket, LIVE_SOCKET.snapshot);
    const eventPromise = waitFor<LiveEvent>(socket, LIVE_SOCKET.event);

    const res = await t.fastify.inject({
      method: 'POST',
      url: '/clock',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
      payload: { op: 'jumpToTime', time: '20:00' },
    });
    expect(res.statusCode).toBe(200);
    const snap = res.json() as ClockSnapshot;
    expect(snap.live).toBe(false);
    expect(zonedDateParts(snap.virtualNow, 'Asia/Dubai')).toMatchObject({ hour: 20, minute: 0 });
    expect(pushed.at(-1)).toEqual({ tenant: 'alpha', state: snap.state });

    const event = await eventPromise;
    expect(event.kind).toBe('clock');
    if (event.kind === 'clock') expect(event.virtualNow).toBe(snap.virtualNow);
    socket.disconnect();

    // reading it back agrees, and the internal endpoint the simulator uses does too
    const again = await t.fastify.inject({
      method: 'GET',
      url: '/clock',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
    });
    expect(again.json().state).toEqual(snap.state);
    const internal = await t.fastify.inject({
      method: 'GET',
      url: '/internal/clock/alpha',
      headers: { 'x-internal-token': t.config.INTERNAL_API_TOKEN },
    });
    expect(internal.statusCode).toBe(200);
    expect(internal.json().state).toEqual(snap.state);
    expect(
      (await t.fastify.inject({ method: 'GET', url: '/internal/clock/alpha' })).statusCode,
    ).toBe(401);
  });

  it('leaves the clock untouched when the simulator is unreachable, and resets to live', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const before = (
      await t.fastify.inject({
        method: 'GET',
        url: '/clock',
        headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
      })
    ).json() as ClockSnapshot;

    simulatorDown = true;
    const failed = await t.fastify.inject({
      method: 'POST',
      url: '/clock',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
      payload: { op: 'speed', speed: 60 },
    });
    simulatorDown = false;
    expect(failed.statusCode).toBe(502);
    const after = (
      await t.fastify.inject({
        method: 'GET',
        url: '/clock',
        headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
      })
    ).json() as ClockSnapshot;
    expect(after.state).toEqual(before.state);

    const reset = await t.fastify.inject({
      method: 'POST',
      url: '/clock',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
      payload: { op: 'reset' },
    });
    expect(reset.json().live).toBe(true);
    expect(
      (
        await t.fastify.inject({
          method: 'POST',
          url: '/clock',
          headers: { host: 'alpha.localhost', authorization: `Bearer ${admin}` },
          payload: { op: 'speed', speed: 99_999 },
        })
      ).statusCode,
    ).toBe(400);
  });
});
