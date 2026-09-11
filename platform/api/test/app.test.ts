import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping API integration tests');

describe.skipIf(!integrationEnabled)('API (integration)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('GET /health reports every dependency', async () => {
    const res = await t.fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      checks: { postgres: 'ok', redis: 'ok', thingsboard: 'ok' },
    });
  });

  it('serves OpenAPI at /docs', async () => {
    const res = await t.fastify.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/auth/login',
        '/me',
        '/branding',
        '/health',
        '/locations/floors/{floor}/plan',
      ]),
    );
    expect(Object.keys(doc.paths)).not.toContain('/internal/tb/events');
  });

  it('resolves branding by Host and answers 404 for unknown hosts', async () => {
    const a = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'alpha.localhost:8081' },
    });
    const b = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'beta.localhost' },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({
      tenantKey: 'alpha',
      logoUrl: '/branding/logo',
      demoMode: true,
    });
    expect(b.json()).toMatchObject({ tenantKey: 'beta', primaryColor: '#B5451B', demoMode: false });
    const logo = await t.fastify.inject({
      method: 'GET',
      url: '/branding/logo',
      headers: { host: 'alpha.localhost' },
    });
    expect(logo.headers['content-type']).toContain('image/svg+xml');
    const unknown = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'nobody.localhost' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers['content-type']).toContain('application/problem+json');
  });

  it('logs in, returns /me, and rejects bad credentials with problem+json', async () => {
    const token = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const me = await t.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: 'admin@alpha.demo', role: 'TENANT_ADMIN' },
      tenant: { key: 'alpha', demoMode: true },
    });
    const bad = await t.fastify.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'alpha.localhost' },
      payload: { email: 'admin@alpha.demo', password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toMatchObject({ status: 401, title: 'Unauthorized' });
    const invalid = await t.fastify.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'alpha.localhost' },
      payload: { email: 'not-an-email' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().errors.length).toBeGreaterThan(0);
  });

  it('refreshes tokens', async () => {
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'alpha.localhost' },
      payload: { email: 'admin@alpha.demo', password: 'Demo1234!' },
    });
    const { refreshToken } = res.json() as { refreshToken: string };
    const refreshed = await t.fastify.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { host: 'alpha.localhost' },
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toHaveProperty('accessToken');
  });

  it('returns the floor plan with rooms', async () => {
    const token = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const res = await t.fastify.inject({
      method: 'GET',
      url: '/locations/floors/1/plan',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.rooms.map((r: { code: string }) => r.code)).toEqual(['1.1']);
    expect(plan.rooms[0].geometry).toEqual({ x: 40, y: 40, w: 160, h: 180 });
  });

  it('refuses VIEWER on the console with 403 and writes a DENIED audit row', async () => {
    const token = await login(t, 'alpha.localhost', 'viewer@alpha.demo');
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/console/scenario/lunch-peak',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    const { withTenant } = await import('../src/db/tenant.js');
    const { auditLog } = await import('../src/db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await withTenant(t.db.app, t.alpha.id, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'DENIED')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'USER',
      entityType: 'route',
      entityId: 'POST /console/scenario/:name',
    });
    expect(rows[0]!.after).toMatchObject({ role: 'VIEWER', required: ['TENANT_ADMIN'] });
  });

  it('hides the console for tenants outside demo mode', async () => {
    const token = await login(t, 'beta.localhost', 'admin@beta.demo');
    const res = await t.fastify.inject({
      method: 'GET',
      url: '/console/state',
      headers: { host: 'beta.localhost', authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('answers 502 when the simulator is unreachable', async () => {
    const token = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const res = await t.fastify.inject({
      method: 'GET',
      url: '/console/state',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(502);
  });
});
