import { describe, expect, it } from 'vitest';
import type { TenantRow } from '../../db/schema/index.js';
import { TenantResolver, hostnameOf } from './tenant-resolver.js';
import type { TenantsService } from './tenants.service.js';

const alpha = { id: 'a', key: 'alpha', hostname: 'alpha.localhost', demoMode: true } as TenantRow;
const gamma = { id: 'g', key: 'gamma', hostname: 'gamma.localhost', demoMode: false } as TenantRow;

function fakeTenants(): TenantsService & { calls: number } {
  const rows = [alpha, gamma];
  const svc = {
    calls: 0,
    async byHostname(h: string) {
      svc.calls++;
      return rows.find((r) => r.hostname === h) ?? null;
    },
    async byKey(k: string) {
      svc.calls++;
      return rows.find((r) => r.key === k) ?? null;
    },
  };
  return svc as unknown as TenantsService & { calls: number };
}

describe('hostnameOf', () => {
  it('strips the port and lower-cases', () => {
    expect(hostnameOf('Alpha.Localhost:8081')).toBe('alpha.localhost');
    expect(hostnameOf(['beta.localhost'])).toBe('beta.localhost');
    expect(hostnameOf(undefined)).toBeNull();
  });
});

describe('TenantResolver', () => {
  it('resolves by host with port and caches', async () => {
    const tenants = fakeTenants();
    const resolver = new TenantResolver(tenants);
    expect(await resolver.resolve({ host: 'alpha.localhost:8081' })).toBe(alpha);
    expect(await resolver.resolve({ host: 'alpha.localhost:4000' })).toBe(alpha);
    expect(tenants.calls).toBe(1);
  });

  it('returns null for unknown hosts', async () => {
    const resolver = new TenantResolver(fakeTenants());
    expect(await resolver.resolve({ host: 'nobody.localhost' })).toBeNull();
  });

  it('accepts X-Tenant-Key only for demo-mode tenants', async () => {
    const resolver = new TenantResolver(fakeTenants());
    expect(await resolver.resolve({ host: '192.168.1.5:8081', tenantKeyHeader: 'alpha' })).toBe(
      alpha,
    );
    expect(
      await resolver.resolve({ host: '192.168.1.5:8081', tenantKeyHeader: 'gamma' }),
    ).toBeNull();
  });

  it('expires cache entries', async () => {
    let now = 0;
    const tenants = fakeTenants();
    const resolver = new TenantResolver(tenants, 1000, () => now);
    await resolver.resolve({ host: 'alpha.localhost' });
    now = 2000;
    await resolver.resolve({ host: 'alpha.localhost' });
    expect(tenants.calls).toBe(2);
  });
});
