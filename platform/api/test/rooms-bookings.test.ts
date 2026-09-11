import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, locations } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled)
  console.log('TEST_DATABASE_URL not set: skipping rooms and bookings tests');

const OCC_ID = '66666666-6666-4666-8666-666666666666';

describe.skipIf(!integrationEnabled)('rooms and bookings (integration)', () => {
  let t: TestApp;
  let roomId: string;
  const auth = (token: string) => ({ host: 'alpha.localhost', authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await buildTestApp();
    await runWithContext({ requestId: 'system', tenantId: t.alpha.id, tenantKey: 'alpha' }, () =>
      withTenant(t.db.app, t.alpha.id, async (tx) => {
        const [room] = await tx.select().from(locations).where(eq(locations.type, 'ROOM'));
        roomId = room!.id;
        await tx.update(locations).set({ capacity: 6 }).where(eq(locations.id, roomId));
        await tx.insert(assets).values({
          tenantId: t.alpha.id,
          code: 'OCC-1.1',
          name: 'Occupancy 1.1',
          class: 'device',
          type: 'occupancy',
          deviceType: 'occupancy',
          tbDeviceId: OCC_ID,
          locationId: roomId,
          meta: {},
        });
      }),
    );
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates a booking, refuses overlaps, lists and cancels; the room goes BOOKED then FREE', async () => {
    const field = await login(t, 'alpha.localhost', 'field@alpha.demo');
    const now = await t.container.clock.now('alpha');
    const start = new Date(now - 60_000).toISOString();
    const end = new Date(now + 30 * 60_000).toISOString();
    const created = await t.fastify.inject({
      method: 'POST',
      url: '/bookings',
      headers: auth(field),
      payload: { roomId, start, end, title: 'Design review', attendance: 'GHOST' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      roomCode: '1.1',
      status: 'ACTIVE',
      attendance: 'GHOST',
    });

    const clash = await t.fastify.inject({
      method: 'POST',
      url: '/bookings',
      headers: auth(field),
      payload: { roomId, start, end: new Date(now + 60 * 60_000).toISOString(), title: 'Clash' },
    });
    expect(clash.statusCode).toBe(409);
    const backwards = await t.fastify.inject({
      method: 'POST',
      url: '/bookings',
      headers: auth(field),
      payload: { roomId, start: end, end: start, title: 'Backwards' },
    });
    expect(backwards.statusCode).toBe(400);

    const rooms = await t.fastify.inject({ method: 'GET', url: '/rooms', headers: auth(field) });
    expect(rooms.statusCode).toBe(200);
    const room = rooms.json().items.find((r: { code: string }) => r.code === '1.1');
    expect(room).toMatchObject({ status: 'BOOKED', occupied: false, peopleCount: 0 });
    expect(room.currentBooking.title).toBe('Design review');

    const internal = await t.fastify.inject({
      method: 'GET',
      url: '/internal/bookings/now?tenant=alpha',
      headers: { 'x-internal-token': t.config.INTERNAL_API_TOKEN },
    });
    expect(internal.statusCode).toBe(200);
    expect(internal.json().items).toEqual([
      expect.objectContaining({ roomCode: '1.1', attendance: 'GHOST', attendees: 0 }),
    ]);
    expect(
      (await t.fastify.inject({ method: 'GET', url: '/internal/bookings/now?tenant=alpha' }))
        .statusCode,
    ).toBe(401);

    const detail = await t.fastify.inject({
      method: 'GET',
      url: `/rooms/${roomId}`,
      headers: auth(field),
    });
    expect(detail.json().bookingsToday).toHaveLength(1);
    expect(detail.json().devices.map((d: { code: string }) => d.code)).toEqual(['OCC-1.1']);

    const list = await t.fastify.inject({
      method: 'GET',
      url: `/bookings?roomId=${roomId}`,
      headers: auth(field),
    });
    expect(list.json().items).toHaveLength(1);

    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    expect(
      (
        await t.fastify.inject({
          method: 'POST',
          url: `/bookings/${created.json().id}/cancel`,
          headers: auth(viewer),
        })
      ).statusCode,
    ).toBe(403);
    const cancelled = await t.fastify.inject({
      method: 'POST',
      url: `/bookings/${created.json().id}/cancel`,
      headers: auth(field),
    });
    expect(cancelled.json().status).toBe('CANCELLED');
    expect(
      (
        await t.fastify.inject({
          method: 'POST',
          url: `/bookings/${created.json().id}/cancel`,
          headers: auth(field),
        })
      ).statusCode,
    ).toBe(409);
    const after = await t.fastify.inject({ method: 'GET', url: '/rooms', headers: auth(field) });
    expect(after.json().items[0].status).toBe('FREE');
  });

  it('an occupancy sensor makes the room BUSY through the event ingress', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers: { 'x-internal-token': t.config.INTERNAL_API_TOKEN },
      payload: {
        type: 'telemetry',
        originator: { id: OCC_ID, entityType: 'DEVICE', name: 'OCC-1.1', type: 'occupancy' },
        ts: Date.now(),
        data: { occupied: 1, count: 3 },
        metadata: {},
      },
    });
    expect(res.statusCode).toBe(204);
    const rooms = await t.fastify.inject({
      method: 'GET',
      url: '/rooms?floor=1',
      headers: auth(admin),
    });
    expect(rooms.json().items[0]).toMatchObject({ status: 'BUSY', occupied: true, peopleCount: 3 });
    // bookings in a room of another tenant look non-existent
    const [betaRoom] = await withTenant(t.db.app, t.beta.id, (tx) =>
      tx.select().from(locations).where(eq(locations.type, 'ROOM')),
    );
    expect(
      (
        await t.fastify.inject({
          method: 'GET',
          url: `/rooms/${betaRoom!.id}`,
          headers: auth(admin),
        })
      ).statusCode,
    ).toBe(404);
  });
});
