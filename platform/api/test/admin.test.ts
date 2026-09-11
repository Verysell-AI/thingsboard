import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminTenant, AdminUser } from '@platform/shared/dto';
import { tenants } from '../src/db/schema/index.js';
import { withoutTenant } from '../src/db/tenant.js';
import { defaultBrand } from '../src/services/tenants/tenants.service.js';
import { buildTestApp, integrationEnabled, login, type TestApp } from './helpers/build-test-app.js';

if (!integrationEnabled) console.log('TEST_DATABASE_URL not set: skipping platform console tests');

const OPERATOR = 'operator@platform.test';
const OPERATOR_PASSWORD = 'Operator1234!';
/** The console is served on the bare host, without a tenant. */
const CONSOLE_HOST = 'localhost:8081';
/** 1x1 transparent PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe.skipIf(!integrationEnabled)('platform console (integration)', () => {
  let t: TestApp;
  let token: string;

  const auth = (extra: Record<string, string> = {}) => ({
    host: CONSOLE_HOST,
    authorization: `Bearer ${token}`,
    ...extra,
  });

  beforeAll(async () => {
    t = await buildTestApp();
    await t.container.platformAdmins.seed(OPERATOR, OPERATOR_PASSWORD, 'Operator');
    const res = await t.fastify.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { host: CONSOLE_HOST },
      payload: { email: OPERATOR, password: OPERATOR_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    token = (res.json() as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('rejects a wrong password and reports the signed-in operator', async () => {
    const bad = await t.fastify.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { host: CONSOLE_HOST },
      payload: { email: OPERATOR, password: 'not-the-password' },
    });
    expect(bad.statusCode).toBe(401);

    const me = await t.fastify.inject({ method: 'GET', url: '/admin/auth/me', headers: auth() });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: OPERATOR, displayName: 'Operator' });
  });

  it('keeps tenant and platform sessions apart in both directions', async () => {
    const tenantToken = await login(t, 'alpha.localhost', 'admin@alpha.demo');
    const asTenant = await t.fastify.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { host: CONSOLE_HOST, authorization: `Bearer ${tenantToken}` },
    });
    expect(asTenant.statusCode).toBe(401);

    // a token that belongs to no tenant looks to the tenant app like the entity does not exist
    const asPlatform = await t.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { host: 'alpha.localhost', authorization: `Bearer ${token}` },
    });
    expect(asPlatform.statusCode).toBe(404);

    const anonymous = await t.fastify.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { host: CONSOLE_HOST },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('lists tenants with user counts and links on the console origin', async () => {
    const res = await t.fastify.inject({ method: 'GET', url: '/admin/tenants', headers: auth() });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: AdminTenant[] }).items;
    expect(items.map((i) => i.key)).toEqual(['alpha', 'beta']);
    const alpha = items[0]!;
    expect(alpha.userCount).toBe(5);
    expect(alpha.url).toBe('http://alpha.localhost:8081');
    expect(alpha.logoUrl).toBe('http://alpha.localhost:8081/api/branding/logo');
  });

  it('rejects a duplicate key and reports an unknown tenant', async () => {
    const duplicate = await t.fastify.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: auth(),
      payload: { key: 'alpha', name: 'Alpha again' },
    });
    expect(duplicate.statusCode).toBe(409);

    const missing = await t.fastify.inject({
      method: 'GET',
      url: '/admin/tenants/nowhere',
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('updates settings and serves an uploaded PNG logo to the tenant app', async () => {
    const res = await t.fastify.inject({
      method: 'PATCH',
      url: '/admin/tenants/beta',
      headers: auth(),
      payload: {
        currency: 'EUR',
        tariffPerKwh: 0.31,
        demoMode: true,
        brand: {
          shortName: 'Beta Co',
          primaryColor: '#123456',
          loginTagline: 'Powered by Beta',
          logo: { mime: 'image/png', content: PNG },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as AdminTenant;
    expect(updated).toMatchObject({
      currency: 'EUR',
      tariffPerKwh: 0.31,
      demoMode: true,
      shortName: 'Beta Co',
      primaryColor: '#123456',
      loginTagline: 'Powered by Beta',
    });

    const branding = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'beta.localhost' },
    });
    expect(branding.json()).toMatchObject({ primaryColor: '#123456', shortName: 'Beta Co' });

    const logo = await t.fastify.inject({
      method: 'GET',
      url: '/branding/logo',
      headers: { host: 'beta.localhost' },
    });
    expect(logo.headers['content-type']).toContain('image/png');
    expect(logo.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);

    // editing only the brand must not reset the settings the operator never touched
    const brandOnly = await t.fastify.inject({
      method: 'PATCH',
      url: '/admin/tenants/beta',
      headers: auth(),
      payload: { brand: { accentColor: '#654321' } },
    });
    expect(brandOnly.statusCode).toBe(200);
    expect(brandOnly.json()).toMatchObject({
      currency: 'EUR',
      tariffPerKwh: 0.31,
      demoMode: true,
      accentColor: '#654321',
    });
  });

  it('renames a tenant and follows the new name in the brand', async () => {
    await withoutTenant(t.db.admin, (tx) =>
      tx.insert(tenants).values({
        key: 'gamma',
        name: 'Gamma',
        hostname: 'gamma.localhost',
        brand: defaultBrand('Gamma'),
      }),
    );

    const res = await t.fastify.inject({
      method: 'PATCH',
      url: '/admin/tenants/gamma',
      headers: auth(),
      payload: { name: 'Gamma Holdings' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as AdminTenant).name).toBe('Gamma Holdings');

    const branding = await t.fastify.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'gamma.localhost' },
    });
    expect(branding.json()).toMatchObject({ name: 'Gamma Holdings' });
  });

  it('rejects a hostname another tenant already uses', async () => {
    const res = await t.fastify.inject({
      method: 'PATCH',
      url: '/admin/tenants/gamma',
      headers: auth(),
      payload: { hostname: 'alpha.localhost' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('creates, updates and removes a tenant user that can then sign in', async () => {
    const created = await t.fastify.inject({
      method: 'POST',
      url: '/admin/tenants/gamma/users',
      headers: auth(),
      payload: {
        email: 'Boss@gamma.demo',
        password: 'Gamma1234!',
        role: 'TENANT_ADMIN',
        displayName: 'Boss',
      },
    });
    expect(created.statusCode).toBe(201);
    const user = created.json() as AdminUser;
    expect(user.email).toBe('boss@gamma.demo');

    const tenantToken = await login(t, 'gamma.localhost', 'boss@gamma.demo', 'Gamma1234!');
    expect(tenantToken).toBeTruthy();

    const duplicate = await t.fastify.inject({
      method: 'POST',
      url: '/admin/tenants/gamma/users',
      headers: auth(),
      payload: { email: 'boss@gamma.demo', password: 'Gamma1234!', role: 'VIEWER' },
    });
    expect(duplicate.statusCode).toBe(409);

    const patched = await t.fastify.inject({
      method: 'PATCH',
      url: `/admin/tenants/gamma/users/${user.id}`,
      headers: auth(),
      payload: { role: 'FINANCE', password: 'Gamma5678!' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as AdminUser).role).toBe('FINANCE');
    expect(await login(t, 'gamma.localhost', 'boss@gamma.demo', 'Gamma5678!')).toBeTruthy();

    const removed = await t.fastify.inject({
      method: 'DELETE',
      url: `/admin/tenants/gamma/users/${user.id}`,
      headers: auth(),
    });
    expect(removed.statusCode).toBe(204);

    const list = await t.fastify.inject({
      method: 'GET',
      url: '/admin/tenants/gamma/users',
      headers: auth(),
    });
    expect((list.json() as { items: AdminUser[] }).items).toEqual([]);
  });

  it('reports an unknown job', async () => {
    const res = await t.fastify.inject({
      method: 'GET',
      url: '/admin/jobs/does-not-exist',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
