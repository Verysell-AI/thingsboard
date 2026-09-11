import { eq } from 'drizzle-orm';
import { MockAgent } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, auditLog, commands, employees, locations } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping asset register tests');

const LIGHT_ID = '44444444-4444-4444-8444-444444444444';

describe.skipIf(!integrationEnabled)('asset register, commands and employees (integration)', () => {
  let t: TestApp;
  let lightAssetId: string;
  let roomId: string;
  let openPlanId: string;
  const simulatorAdds: unknown[] = [];
  let simulatorDown = false;
  const auth = (token: string) => ({ host: 'alpha.localhost', authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent
      .get('http://simulator.test:4100')
      .intercept({ path: /^\/devices/, method: 'POST' })
      .reply((opts) => {
        if (simulatorDown) return { statusCode: 503, data: { message: 'down' } };
        simulatorAdds.push(JSON.parse(String(opts.body)));
        return { statusCode: 201, data: { ok: true } };
      })
      .persist();
    t = await buildTestApp({ simulatorDispatcher: agent });
    await runWithContext({ requestId: 'system', tenantId: t.alpha.id, tenantKey: 'alpha' }, () =>
      withTenant(t.db.app, t.alpha.id, async (tx) => {
        const [room] = await tx.select().from(locations).where(eq(locations.type, 'ROOM'));
        roomId = room!.id;
        const [openPlan] = await tx
          .insert(locations)
          .values({
            tenantId: t.alpha.id,
            type: 'ROOM',
            code: '1.O',
            name: 'Open plan',
            parentId: room!.parentId,
            floor: 1,
            zone: '1.West',
            kind: 'open_plan',
            tbAssetId: 'tb-room-1o',
            geometry: {
              x: 0,
              y: 300,
              w: 900,
              h: 200,
              desks: [
                { code: 'D-1.O-01', zone: '1.West', x: 100, y: 340, employeeId: null },
                { code: 'D-1.O-02', zone: '1.West', x: 200, y: 340, employeeId: null },
              ],
            },
          })
          .returning();
        openPlanId = openPlan!.id;
        const [emp] = await tx
          .insert(employees)
          .values({
            tenantId: t.alpha.id,
            code: 'E001',
            name: 'Amira Haddad',
            department: 'Sales',
            deskRoomId: openPlanId,
            deskCode: 'D-1.O-01',
            zone: '1.West',
            email: 'amira.haddad@alpha.demo',
          })
          .returning();
        const [light] = await tx
          .insert(assets)
          .values({
            tenantId: t.alpha.id,
            code: 'LIGHT-1.1',
            name: 'Light 1.1',
            class: 'device',
            type: 'light',
            deviceType: 'light',
            tbDeviceId: LIGHT_ID,
            locationId: roomId,
            brand: 'Lumenor',
            purchaseDate: '2024-01-01',
            purchaseCost: '180.00',
            usefulLifeYears: 8,
            meta: { nominalPowerW: 60, x: 1, y: 2, accessToken: 'secret' },
          })
          .returning();
        lightAssetId = light!.id;
        await tx.insert(assets).values({
          tenantId: t.alpha.id,
          code: 'LAPTOP-E001',
          name: 'Laptop E001',
          class: 'laptop',
          type: 'laptop',
          deviceType: 'laptop',
          tbDeviceId: '55555555-5555-4555-8555-555555555555',
          locationId: openPlanId,
          custodianEmployeeId: emp!.id,
          meta: {},
        });
      }),
    );
  });
  afterAll(async () => {
    await t?.close();
  });

  it('lists, searches and filters the register with book values; finance is refused', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const all = await t.fastify.inject({ method: 'GET', url: '/assets', headers: auth(admin) });
    expect(all.statusCode).toBe(200);
    expect(all.json().total).toBe(2);
    const light = all.json().items.find((a: { code: string }) => a.code === 'LIGHT-1.1');
    expect(light.location.code).toBe('1.1');
    expect(light.bookValue).toBeGreaterThan(0);
    expect(light.bookValue).toBeLessThan(180);

    const search = await t.fastify.inject({
      method: 'GET',
      url: '/assets?search=amira',
      headers: auth(admin),
    });
    expect(search.json().items.map((a: { code: string }) => a.code)).toEqual(['LAPTOP-E001']);
    const byRoom = await t.fastify.inject({
      method: 'GET',
      url: '/assets?room=1.1&class=device',
      headers: auth(admin),
    });
    expect(byRoom.json().total).toBe(1);
    const facets = await t.fastify.inject({
      method: 'GET',
      url: '/assets/facets',
      headers: auth(admin),
    });
    expect(facets.json().classes).toEqual(['device', 'laptop']);
    expect(facets.json().custodians).toHaveLength(1);

    const finance = await login(t, 'alpha.localhost', 'finance@alpha.demo');
    expect(
      (await t.fastify.inject({ method: 'GET', url: '/assets', headers: auth(finance) }))
        .statusCode,
    ).toBe(403);
    // finance keeps energy and notifications
    expect(
      (await t.fastify.inject({ method: 'GET', url: '/energy/summary', headers: auth(finance) }))
        .statusCode,
    ).toBe(200);
  });

  it('detail hides the access token, and a custodian change is audited as custody', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const detail = await t.fastify.inject({
      method: 'GET',
      url: `/assets/${lightAssetId}`,
      headers: auth(admin),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().attributes).toEqual({ nominalPowerW: 60 });
    const [emp] = await withTenant(t.db.app, t.alpha.id, (tx) => tx.select().from(employees));
    const patched = await t.fastify.inject({
      method: 'PATCH',
      url: `/assets/${lightAssetId}`,
      headers: auth(admin),
      payload: { custodianEmployeeId: emp!.id, name: 'Light 1.1 (west)' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().custodian.name).toBe('Amira Haddad');
    const after = await t.fastify.inject({
      method: 'GET',
      url: `/assets/${lightAssetId}`,
      headers: auth(admin),
    });
    expect(after.json().custody).toHaveLength(1);
    expect(after.json().custody[0].to.name).toBe('Amira Haddad');
    expect(after.json().audit.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['asset.update', 'asset.custody']),
    );
    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    expect(
      (
        await t.fastify.inject({
          method: 'PATCH',
          url: `/assets/${lightAssetId}`,
          headers: auth(viewer),
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('commands: viewer refused and audited DENIED; field operator sends the RPC', async () => {
    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    const denied = await t.fastify.inject({
      method: 'POST',
      url: `/assets/${lightAssetId}/commands`,
      headers: auth(viewer),
      payload: { method: 'setState', params: { state: 0 } },
    });
    expect(denied.statusCode).toBe(403);
    const deniedRows = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'DENIED')),
    );
    expect(deniedRows.some((r) => r.entityId === 'POST /assets/:id/commands')).toBe(true);

    const field = await login(t, 'alpha.localhost', 'field@alpha.demo');
    const ok = await t.fastify.inject({
      method: 'POST',
      url: `/assets/${lightAssetId}/commands`,
      headers: auth(field),
      payload: { method: 'setState', params: { state: 0 } },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ method: 'setState', source: 'USER', result: 'SENT' });
    expect(t.rpcCalls).toEqual([
      { tenantKey: 'alpha', deviceId: LIGHT_ID, method: 'setState', params: { state: 0 } },
    ]);
    const rows = await withTenant(t.db.app, t.alpha.id, (tx) => tx.select().from(commands));
    expect(rows).toHaveLength(1);
    const bad = await t.fastify.inject({
      method: 'POST',
      url: `/assets/${lightAssetId}/commands`,
      headers: auth(field),
      payload: { method: 'setSetpoint', params: { setpoint_c: 22 } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('serves telemetry history through the ThingsBoard proxy', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    t.timeseries.power_w = [{ ts: 1_000, value: '60' }];
    const res = await t.fastify.inject({
      method: 'GET',
      url: `/assets/${lightAssetId}/history?keys=power_w`,
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().series.power_w).toEqual([{ ts: 1000, value: 60 }]);
    expect(t.tbCalls.filter((c) => c.method === 'getTimeseries')).toHaveLength(1);
  });

  it('creates an employee with laptop asset, device and simulated laptop', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/employees',
      headers: auth(admin),
      payload: {
        name: 'Nadia Karim',
        department: 'Engineering',
        deskRoomId: openPlanId,
        persona: 'late_worker',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.employee).toMatchObject({
      code: 'E002',
      deskCode: 'D-1.O-02',
      email: 'nadia.karim@alpha.demo',
      persona: 'late_worker',
    });
    expect(body.asset).toMatchObject({ code: 'LAPTOP-E002', class: 'laptop', status: 'ACTIVE' });
    expect(body.asset.custodian.name).toBe('Nadia Karim');
    expect(body.simulated).toBe(true);
    expect(simulatorAdds).toHaveLength(1);
    expect(simulatorAdds[0]).toMatchObject({
      code: 'LAPTOP-E002',
      attrs: { room: '1.O', persona: 'late_worker', user: 'nadia.karim' },
    });
    const saved = t.tbCalls.filter((c) => c.method === 'saveDevice');
    expect(saved.at(-1)?.args[0]).toMatchObject({ name: 'LAPTOP-E002', type: 'laptop' });
    expect(t.tbCalls.some((c) => c.method === 'saveRelation')).toBe(true);
    const [room] = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(locations).where(eq(locations.id, openPlanId)),
    );
    expect(room!.geometry?.desks?.find((d) => d.code === 'D-1.O-02')?.employeeId).toBe(
      body.employee.id,
    );
    const list = await t.fastify.inject({ method: 'GET', url: '/employees', headers: auth(admin) });
    expect(list.json().items.map((e: { code: string }) => e.code)).toEqual(['E001', 'E002']);
    expect(list.json().items[1].laptop.code).toBe('LAPTOP-E002');
  });

  it('rolls back and deletes the device when the simulator refuses', async () => {
    const admin = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    simulatorDown = true;
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/employees',
      headers: auth(admin),
      payload: { name: 'Will Fail', department: 'Sales', deskRoomId: roomId },
    });
    simulatorDown = false;
    expect(res.statusCode).toBe(502);
    const deleted = t.tbCalls.filter((c) => c.method === 'deleteDevice');
    expect(deleted).toHaveLength(1);
    const rows = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(employees).where(eq(employees.name, 'Will Fail')),
    );
    expect(rows).toHaveLength(0);
    const laptops = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(assets).where(eq(assets.code, 'LAPTOP-E003')),
    );
    expect(laptops).toHaveLength(0);
    // viewers may not create employees; a full open plan grows a new desk instead of refusing the hire
    const viewer = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    expect(
      (
        await t.fastify.inject({
          method: 'POST',
          url: '/employees',
          headers: auth(viewer),
          payload: { name: 'No Rights', department: 'Sales', deskRoomId: openPlanId },
        })
      ).statusCode,
    ).toBe(403);
    const [before] = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(locations).where(eq(locations.id, openPlanId)),
    );
    const desksBefore = before!.geometry?.desks?.length ?? 0;
    const grown = await t.fastify.inject({
      method: 'POST',
      url: '/employees',
      headers: auth(admin),
      payload: { name: 'Extra Desk', department: 'Sales', deskRoomId: openPlanId },
    });
    expect(grown.statusCode).toBe(201);
    expect(grown.json().employee.deskCode).toBe(
      `D-1.O-${String(desksBefore + 1).padStart(2, '0')}`,
    );
    const [after] = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(locations).where(eq(locations.id, openPlanId)),
    );
    expect(after!.geometry?.desks).toHaveLength(desksBefore + 1);
  });
});
