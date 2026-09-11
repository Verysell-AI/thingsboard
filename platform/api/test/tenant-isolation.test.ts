import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, auditLog, commands, locations } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { runWithContext } from '../src/lib/context.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping tenant isolation tests');

describe.skipIf(!integrationEnabled)('tenant isolation (integration)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('withTenant(alpha) never returns beta rows even without a tenant filter', async () => {
    const rows = await withTenant(t.db.app, t.alpha.id, (tx) => tx.select().from(locations));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === t.alpha.id)).toBe(true);
    const betaRows = await withTenant(t.db.app, t.beta.id, (tx) => tx.select().from(locations));
    expect(betaRows.every((r) => r.tenantId === t.beta.id)).toBe(true);
  });

  it('a query outside withTenant on the app role sees no rows', async () => {
    const rows = await t.db.app.select().from(locations);
    expect(rows).toEqual([]);
    const admin = await t.db.admin.select().from(locations);
    expect(admin.length).toBeGreaterThan(0);
  });

  it('withTenant(alpha) cannot insert a row for beta', async () => {
    const err = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.insert(locations).values({ tenantId: t.beta.id, type: 'ROOM', code: 'X', name: 'X' }),
    ).catch((e: unknown) => e);
    const message = [err, (err as { cause?: unknown }).cause]
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join(' | ');
    expect(message).toMatch(/row-level security/);
  });

  it('a beta location id requested as alpha is a 404, never a 403', async () => {
    const [betaRoom] = await withTenant(t.db.app, t.beta.id, (tx) =>
      tx.select().from(locations).where(eq(locations.type, 'ROOM')),
    );
    const alphaToken = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const res = await t.fastify.inject({
      method: 'GET',
      url: `/locations/${betaRoom!.id}`,
      headers: { host: 'alpha.localhost', authorization: `Bearer ${alphaToken}` },
    });
    expect(res.statusCode).toBe(404);
    const own = await t.fastify.inject({
      method: 'GET',
      url: `/locations/${betaRoom!.id}`,
      headers: {
        host: 'beta.localhost',
        authorization: `Bearer ${await login(t, 'beta.localhost', 'admin@beta.demo')}`,
      },
    });
    expect(own.statusCode).toBe(200);
  });

  it('every id discovered through the beta API is a 404 for an alpha user, and vice versa', async () => {
    const pairs: [string, string][] = [
      ['alpha', 'beta'],
      ['beta', 'alpha'],
    ];
    for (const [mine, theirs] of pairs) {
      const ownToken = await login(t, `${theirs}.localhost`, `admin@${theirs}.demo`);
      const own = (url: string) =>
        t.fastify
          .inject({
            method: 'GET',
            url,
            headers: { host: `${theirs}.localhost`, authorization: `Bearer ${ownToken}` },
          })
          .then((r) =>
            r.statusCode === 200 ? (r.json() as { items?: { id: string }[] }) : { items: [] },
          );
      // discover the other tenant's ids from its own API so the list cannot go stale
      const discovered: { url: string; id: string }[] = [];
      for (const [list, detail] of [
        ['/locations', '/locations'],
        ['/assets', '/assets'],
        ['/rooms', '/rooms'],
        ['/employees', '/employees'],
        ['/bookings', '/bookings'],
        ['/maintenance', '/maintenance'],
        ['/reports', '/reports'],
        ['/holds', '/holds'],
      ] as const) {
        for (const item of (await own(list)).items ?? [])
          discovered.push({ url: `${detail}/${item.id}`, id: item.id });
      }
      expect(discovered.length).toBeGreaterThan(0);
      const intruder = await login(t, `${mine}.localhost`, `admin@${mine}.demo`);
      for (const d of discovered) {
        const res = await t.fastify.inject({
          method: 'GET',
          url: d.url,
          headers: { host: `${mine}.localhost`, authorization: `Bearer ${intruder}` },
        });
        expect(res.statusCode, `${mine} reading ${d.url}`).toBe(404);
      }
      // the live snapshot for the intruder's tenant never carries the other tenant's device codes
      const theirCodes = ((await own('/assets')).items ?? []) as { code?: string }[];
      const snapshot = await t.fastify.inject({
        method: 'GET',
        url: `/internal/live/${mine}`,
        headers: { 'x-internal-token': t.config.INTERNAL_API_TOKEN },
      });
      const codes = new Set(
        (snapshot.json() as { devices: { deviceCode: string }[] }).devices.map((d) => d.deviceCode),
      );
      for (const a of theirCodes) if (a.code) expect(codes.has(a.code)).toBe(false);
    }
  });

  it('an alpha token presented on the beta hostname is rejected as 404', async () => {
    const alphaToken = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const res = await t.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { host: 'beta.localhost', authorization: `Bearer ${alphaToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('accepts X-Tenant-Key only for demo-mode tenants', async () => {
    const demo = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: '10.0.0.5:8081', 'x-tenant-key': 'alpha' },
    });
    expect(demo.statusCode).toBe(200);
    const notDemo = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: '10.0.0.5:8081', 'x-tenant-key': 'beta' },
    });
    expect(notDemo.statusCode).toBe(404);
  });

  describe('commands', () => {
    let lightId: string;
    let sensorId: string;
    beforeAll(async () => {
      await runWithContext({ requestId: 'system', tenantId: t.alpha.id, tenantKey: 'alpha' }, () =>
        withTenant(t.db.app, t.alpha.id, async (tx) => {
          const [room] = await tx.select().from(locations).where(eq(locations.type, 'ROOM'));
          const rows = await tx
            .insert(assets)
            .values([
              {
                tenantId: t.alpha.id,
                code: 'LIGHT-1.1',
                name: 'Light',
                class: 'device',
                type: 'light',
                deviceType: 'light',
                tbDeviceId: '33333333-3333-4333-8333-333333333333',
                locationId: room!.id,
              },
              {
                tenantId: t.alpha.id,
                code: 'OCC-1.1',
                name: 'Occupancy',
                class: 'device',
                type: 'occupancy',
                deviceType: 'occupancy',
                tbDeviceId: '44444444-4444-4444-8444-444444444444',
                locationId: room!.id,
              },
            ])
            .returning();
          lightId = rows[0]!.id;
          sensorId = rows[1]!.id;
        }),
      );
    });

    it('sends a valid RPC, records the command and an audit row', async () => {
      const admin = await t.container.users.byEmail(t.alpha.id, 'admin@alpha.demo');
      await runWithContext(
        {
          requestId: 'req-1',
          tenantId: t.alpha.id,
          tenantKey: 'alpha',
          userId: admin!.id,
          userEmail: 'admin@alpha.demo',
          role: 'TENANT_ADMIN',
        },
        async () => {
          const row = await t.container.commands.sendRpc(
            { id: t.alpha.id, key: 'alpha' },
            lightId,
            'setState',
            { state: 0 },
            { source: 'USER', actorUserId: null },
          );
          expect(row.result).toBe('SENT');
        },
      );
      expect(t.rpcCalls).toEqual([
        {
          tenantKey: 'alpha',
          deviceId: '33333333-3333-4333-8333-333333333333',
          method: 'setState',
          params: { state: 0 },
        },
      ]);
      const [cmd] = await withTenant(t.db.app, t.alpha.id, (tx) => tx.select().from(commands));
      expect(cmd).toMatchObject({ method: 'setState', source: 'USER', result: 'SENT' });
      const audits = await withTenant(t.db.app, t.alpha.id, (tx) =>
        tx.select().from(auditLog).where(eq(auditLog.action, 'command.setState')),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: 'USER',
        actorLabel: 'admin@alpha.demo',
        entityId: lightId,
      });
    });

    it('rejects unsupported methods and device types before touching ThingsBoard', async () => {
      const before = t.rpcCalls.length;
      await runWithContext(
        { requestId: 'req-2', tenantId: t.alpha.id, tenantKey: 'alpha' },
        async () => {
          await expect(
            t.container.commands.sendRpc(
              { id: t.alpha.id, key: 'alpha' },
              lightId,
              'explode',
              {},
              { source: 'USER' },
            ),
          ).rejects.toMatchObject({ status: 400 });
          await expect(
            t.container.commands.sendRpc(
              { id: t.alpha.id, key: 'alpha' },
              sensorId,
              'setState',
              { state: 1 },
              { source: 'USER' },
            ),
          ).rejects.toMatchObject({ status: 400 });
          await expect(
            t.container.commands.sendRpc(
              { id: t.alpha.id, key: 'alpha' },
              lightId,
              'setState',
              { state: 2 },
              { source: 'USER' },
            ),
          ).rejects.toMatchObject({ status: 400 });
        },
      );
      expect(t.rpcCalls.length).toBe(before);
    });

    it('cannot command a beta asset from alpha', async () => {
      const [betaRoom] = await withTenant(t.db.app, t.beta.id, (tx) =>
        tx.select().from(locations).where(eq(locations.type, 'ROOM')),
      );
      const betaAsset = await runWithContext(
        { requestId: 'system', tenantId: t.beta.id, tenantKey: 'beta' },
        () =>
          withTenant(t.db.app, t.beta.id, async (tx) => {
            const [row] = await tx
              .insert(assets)
              .values({
                tenantId: t.beta.id,
                code: 'LIGHT-1.1',
                name: 'Light',
                class: 'device',
                type: 'light',
                deviceType: 'light',
                tbDeviceId: '66666666-6666-4666-8666-666666666666',
                locationId: betaRoom!.id,
              })
              .returning();
            return row!;
          }),
      );
      await runWithContext(
        { requestId: 'req-3', tenantId: t.alpha.id, tenantKey: 'alpha' },
        async () => {
          await expect(
            t.container.commands.sendRpc(
              { id: t.alpha.id, key: 'alpha' },
              betaAsset.id,
              'setState',
              { state: 1 },
              { source: 'USER' },
            ),
          ).rejects.toMatchObject({ status: 404 });
        },
      );
    });
  });
});
