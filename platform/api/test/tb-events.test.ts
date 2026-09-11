import { eq } from 'drizzle-orm';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, locations } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled)
  console.log('TEST_DATABASE_URL not set: skipping ThingsBoard event ingress tests');

const DEVICE_ID = '77777777-7777-4777-8777-777777777777';

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe.skipIf(!integrationEnabled)('ThingsBoard events → Redis → WebSocket (integration)', () => {
  let t: TestApp;
  let baseUrl: string;
  beforeAll(async () => {
    t = await buildTestApp();
    await runWithContext({ requestId: 'system', tenantId: t.alpha.id, tenantKey: 'alpha' }, () =>
      withTenant(t.db.app, t.alpha.id, async (tx) => {
        const [room] = await tx.select().from(locations).where(eq(locations.type, 'ROOM'));
        await tx.insert(assets).values({
          tenantId: t.alpha.id,
          code: 'RM-1.1',
          name: 'Room meter',
          class: 'device',
          type: 'room_meter',
          deviceType: 'room_meter',
          tbDeviceId: DEVICE_ID,
          locationId: room!.id,
        });
      }),
    );
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

  const payload = (ts: number, power: number) => ({
    type: 'telemetry',
    originator: { id: DEVICE_ID, entityType: 'DEVICE', name: 'RM-1.1', type: 'room_meter' },
    ts,
    data: { power_w: power },
    metadata: { deviceName: 'RM-1.1' },
  });

  it('rejects calls without the internal token', async () => {
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      payload: payload(Date.now(), 1),
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts unknown devices with 202 and known devices with 204, updating live state', async () => {
    const headers = { 'x-internal-token': t.config.INTERNAL_API_TOKEN };
    const unknown = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers,
      payload: {
        ...payload(Date.now(), 1),
        originator: { id: '88888888-8888-4888-8888-888888888888', entityType: 'DEVICE', name: 'X' },
      },
    });
    expect(unknown.statusCode).toBe(202);
    const stale = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers,
      payload: payload(Date.now() - 10 * 60_000, 999),
    });
    expect(stale.statusCode).toBe(202);
    const ok = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers,
      payload: payload(Date.now(), 123.4),
    });
    expect(ok.statusCode).toBe(204);
    const state = await t.container.liveState.get('alpha', 'RM-1.1');
    expect(state).toMatchObject({
      values: { power_w: 123.4 },
      online: true,
      room: '1.1',
      deviceType: 'room_meter',
    });
    expect(await t.container.liveState.isEmpty('beta')).toBe(true);
  });

  it('delivers events over Socket.IO, sends a snapshot, and replays after reconnect with lastEventId', async () => {
    const token = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const headers = { 'x-internal-token': t.config.INTERNAL_API_TOKEN };

    const socket = ioClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      extraHeaders: { host: 'alpha.localhost' },
    });
    const snapshot = await waitFor<{
      tenantKey: string;
      devices: { deviceCode: string }[];
      lastEventId: string | null;
    }>(socket, 'snapshot');
    expect(snapshot.tenantKey).toBe('alpha');
    expect(snapshot.devices.map((d) => d.deviceCode)).toContain('RM-1.1');

    const eventPromise = waitFor<{ id: string; kind: string; values: Record<string, number> }>(
      socket,
      'event',
    );
    await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers,
      payload: payload(Date.now(), 200),
    });
    const live = await eventPromise;
    expect(live.kind).toBe('device.telemetry');
    expect(live.values.power_w).toBe(200);
    socket.disconnect();

    // Two events happen while the client is offline.
    await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers,
      payload: payload(Date.now(), 300),
    });
    await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers,
      payload: payload(Date.now(), 400),
    });

    const again = ioClient(baseUrl, {
      auth: { token, lastEventId: live.id },
      transports: ['websocket'],
    });
    const replayed: number[] = [];
    again.on('event', (ev: { values: Record<string, number> }) =>
      replayed.push(ev.values.power_w!),
    );
    await waitFor(again, 'snapshot');
    await new Promise((r) => setTimeout(r, 300));
    expect(replayed).toEqual([300, 400]);
    again.disconnect();
  });

  it('refuses sockets without a valid token', async () => {
    const socket = ioClient(baseUrl, { auth: { token: 'nope' }, transports: ['websocket'] });
    const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
    socket.disconnect();
  });
});
