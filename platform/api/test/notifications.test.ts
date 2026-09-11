import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, locations, notifications } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping notification tests');

const LAPTOP_ID = '77777777-7777-4777-8777-777777777771';

describe.skipIf(!integrationEnabled)('notifications from device events (integration)', () => {
  let t: TestApp;
  const auth = (token: string) => ({ host: 'alpha.localhost', authorization: `Bearer ${token}` });
  const internal = () => ({ 'x-internal-token': t.config.INTERNAL_API_TOKEN });

  beforeAll(async () => {
    t = await buildTestApp();
    await runWithContext({ requestId: 'system', tenantId: t.alpha.id, tenantKey: 'alpha' }, () =>
      withTenant(t.db.app, t.alpha.id, async (tx) => {
        const [room] = await tx.select().from(locations).where(eq(locations.type, 'ROOM'));
        await tx.insert(assets).values({
          tenantId: t.alpha.id,
          code: 'LAPTOP-E009',
          name: 'Laptop E009',
          class: 'laptop',
          type: 'laptop',
          deviceType: 'laptop',
          tbDeviceId: LAPTOP_ID,
          locationId: room!.id,
          meta: {},
        });
      }),
    );
  });
  afterAll(async () => {
    await t?.close();
  });

  const inactivity = (ts: number) => ({
    type: 'inactivity',
    originator: { id: LAPTOP_ID, entityType: 'DEVICE', name: 'LAPTOP-E009', type: 'laptop' },
    ts,
    data: { active: false },
    metadata: {},
  });

  it('a silent laptop notifies operations once, not the viewer or finance; read and read-all work', async () => {
    const first = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers: internal(),
      payload: inactivity(Date.now()),
    });
    expect(first.statusCode).toBe(204);
    // the same event a minute later is deduplicated while the first is unread
    await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers: internal(),
      payload: inactivity(Date.now() + 60_000),
    });
    const rows = await withTenant(t.db.app, t.alpha.id, (tx) => tx.select().from(notifications));
    expect(rows).toHaveLength(3); // admin, ops, field

    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const mine = await t.fastify.inject({
      method: 'GET',
      url: '/notifications',
      headers: auth(admin),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ total: 1, unread: 1 });
    expect(mine.json().items[0]).toMatchObject({
      kind: 'asset.unreachable',
      title: 'Asset unreachable: LAPTOP-E009',
      subject: 'LAPTOP-E009',
      readAt: null,
    });

    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    const none = await t.fastify.inject({
      method: 'GET',
      url: '/notifications',
      headers: auth(viewer),
    });
    expect(none.json().total).toBe(0);
    const finance = await login(t, 'alpha.localhost', 'finance@alpha.demo');
    expect(
      (await t.fastify.inject({ method: 'GET', url: '/notifications', headers: auth(finance) }))
        .statusCode,
    ).toBe(200);

    const id = mine.json().items[0].id as string;
    // a notification belongs to its recipient only
    expect(
      (
        await t.fastify.inject({
          method: 'POST',
          url: `/notifications/${id}/read`,
          headers: auth(viewer),
        })
      ).statusCode,
    ).toBe(404);
    const read = await t.fastify.inject({
      method: 'POST',
      url: `/notifications/${id}/read`,
      headers: auth(admin),
    });
    expect(read.json().readAt).not.toBeNull();
    const unread = await t.fastify.inject({
      method: 'GET',
      url: '/notifications?unread=true',
      headers: auth(admin),
    });
    expect(unread.json().items).toHaveLength(0);
    expect(unread.json().unread).toBe(0);

    // once read, a new inactivity creates a fresh notification; read-all clears it
    await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers: internal(),
      payload: inactivity(Date.now() + 120_000),
    });
    const again = await t.fastify.inject({
      method: 'GET',
      url: '/notifications',
      headers: auth(admin),
    });
    expect(again.json()).toMatchObject({ total: 2, unread: 1 });
    const all = await t.fastify.inject({
      method: 'POST',
      url: '/notifications/read-all',
      headers: auth(admin),
    });
    expect(all.json().updated).toBe(1);
    expect(
      (
        await t.fastify.inject({
          method: 'POST',
          url: `/notifications/${id}/act`,
          headers: auth(admin),
          payload: { key: 'nope' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('a ThingsBoard alarm becomes an alarm notification', async () => {
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/internal/tb/events',
      headers: internal(),
      payload: {
        type: 'alarm_created',
        originator: { id: LAPTOP_ID, entityType: 'DEVICE', name: 'LAPTOP-E009', type: 'laptop' },
        ts: Date.now(),
        data: { type: 'Battery low', severity: 'MINOR', id: { id: 'a-1', entityType: 'ALARM' } },
        metadata: {},
      },
    });
    expect(res.statusCode).toBe(204);
    const ops = await login(t, 'alpha.localhost', 'ops@alpha.demo');
    const mine = await t.fastify.inject({
      method: 'GET',
      url: '/notifications',
      headers: auth(ops),
    });
    expect(mine.json().items[0]).toMatchObject({
      kind: 'alarm',
      title: 'Battery low on LAPTOP-E009',
    });
  });
});
