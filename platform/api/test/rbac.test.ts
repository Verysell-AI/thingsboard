import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, type Role } from '@platform/shared/roles';
import { auditLog } from '../src/db/schema/index.js';
import { withTenant } from '../src/db/tenant.js';
import { RBAC_MATRIX, canAccess, type RouteKey } from '../src/hooks/rbac.matrix.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping RBAC route tests');

const ID = '99999999-9999-4999-8999-999999999999';

/** One representative route per access key. A refused call is 403; an allowed one is anything else. */
const ROUTES: Record<
  RouteKey,
  { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; body?: unknown }
> = {
  'locations.read': { method: 'GET', url: '/locations' },
  'assets.read': { method: 'GET', url: '/assets' },
  'assets.update': { method: 'PATCH', url: `/assets/${ID}`, body: { name: 'x' } },
  'assets.command': {
    method: 'POST',
    url: `/assets/${ID}/commands`,
    body: { method: 'setState', params: { state: 0 } },
  },
  'assets.history': { method: 'GET', url: `/assets/${ID}/history?keys=power_w` },
  'employees.read': { method: 'GET', url: '/employees' },
  'employees.create': {
    method: 'POST',
    url: '/employees',
    body: { name: 'Test Person', department: 'Sales', deskRoomId: ID },
  },
  'rooms.read': { method: 'GET', url: '/rooms' },
  'bookings.read': { method: 'GET', url: '/bookings' },
  'bookings.create': {
    method: 'POST',
    url: '/bookings',
    body: {
      roomId: ID,
      start: '2030-01-01T09:00:00.000Z',
      end: '2030-01-01T10:00:00.000Z',
      title: 'Probe',
    },
  },
  'bookings.cancel': { method: 'POST', url: `/bookings/${ID}/cancel`, body: {} },
  'notifications.read': { method: 'GET', url: '/notifications' },
  'notifications.act': { method: 'POST', url: `/notifications/${ID}/act`, body: { key: 'x' } },
  'energy.read': { method: 'GET', url: '/energy/summary' },
  'clock.read': { method: 'GET', url: '/clock' },
  'clock.write': { method: 'POST', url: '/clock', body: { op: 'reset' } },
  'console.use': { method: 'GET', url: '/console/state' },
  'automations.read': { method: 'GET', url: '/automations' },
  'automations.manage': { method: 'PATCH', url: '/automations/room_auto_off', body: {} },
  'automations.run': { method: 'POST', url: '/automations/room_auto_off/run', body: {} },
  'reports.read': { method: 'GET', url: '/reports' },
  'reports.generate': { method: 'POST', url: '/reports/morning/run', body: {} },
  'audit.read': { method: 'GET', url: '/audit' },
  'users.manage': { method: 'GET', url: '/admin/tenants' },
  'maintenance.read': { method: 'GET', url: '/maintenance' },
  'maintenance.manage': {
    method: 'POST',
    url: '/maintenance',
    body: { assetId: ID, title: 'Probe' },
  },
  'standby.ack': { method: 'POST', url: `/energy/standby/${ID}/ack`, body: { acknowledged: true } },
};

describe.skipIf(!integrationEnabled)('RBAC matrix applied to every route (integration)', () => {
  let t: TestApp;
  const tokens = new Map<Role, string>();
  beforeAll(async () => {
    t = await buildTestApp();
    for (const role of ROLES) {
      const local = {
        TENANT_ADMIN: 'admin',
        OPS_MANAGER: 'ops',
        FIELD_OPERATOR: 'field',
        FINANCE: 'finance',
        VIEWER: 'viewer',
      }[role];
      tokens.set(role, await login(t, 'alpha.localhost', `${local}@alpha.demo`));
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  it('every access key has a representative route', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(Object.keys(RBAC_MATRIX).sort());
  });

  for (const role of ROLES) {
    it(`${role} is allowed exactly what the matrix says, and each refusal is audited as DENIED`, async () => {
      const deniedBefore = await withTenant(t.db.app, t.alpha.id, (tx) =>
        tx.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.action, 'DENIED')),
      );
      let refusals = 0;
      for (const [key, route] of Object.entries(ROUTES) as [
        RouteKey,
        (typeof ROUTES)[RouteKey],
      ][]) {
        // the platform console is tenant-less and uses its own operator login
        if (key === 'users.manage') continue;
        const res = await t.fastify.inject({
          method: route.method,
          url: route.url,
          headers: { host: 'alpha.localhost', authorization: `Bearer ${tokens.get(role)}` },
          ...(route.body !== undefined ? { payload: route.body } : {}),
        });
        const allowed = canAccess(role, key);
        if (allowed) {
          expect(res.statusCode, `${role} ${key} ${route.method} ${route.url}`).not.toBe(403);
        } else {
          expect(res.statusCode, `${role} ${key} ${route.method} ${route.url}`).toBe(403);
          refusals++;
        }
      }
      const deniedAfter = await withTenant(t.db.app, t.alpha.id, (tx) =>
        tx
          .select({ id: auditLog.id, entityId: auditLog.entityId, after: auditLog.after })
          .from(auditLog)
          .where(eq(auditLog.action, 'DENIED')),
      );
      expect(deniedAfter.length - deniedBefore.length).toBe(refusals);
      if (refusals)
        expect(
          deniedAfter.some(
            (r) =>
              (r.after as { role?: string }).role === role && String(r.entityId).includes(' /'),
          ),
        ).toBe(true);
    });
  }
});
