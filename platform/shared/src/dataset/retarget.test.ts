import { describe, expect, it } from 'vitest';
import { retargetTenantDataset, tenantFileFor } from './retarget.js';
import type { TenantDataset } from './schema.js';

const alpha: TenantDataset = {
  key: 'alpha',
  name: 'Falcon Facilities Group',
  hostname: 'alpha.localhost',
  locale: 'en',
  currency: 'AED',
  tariffPerKwh: 0.44,
  demoMode: true,
  brand: {
    name: 'Falcon',
    primaryColor: '#000000',
    accentColor: '#ffffff',
    logo: 'brands/alpha/logo.svg',
  },
  employees: [
    {
      code: 'E001',
      name: 'Amira Haddad',
      department: 'Sales',
      deskRoom: '1.O',
      desk: 'D-1.O-01',
      persona: 'standard',
      email: 'amira.haddad@alpha.demo',
    },
  ],
} as TenantDataset;

describe('tenantFileFor', () => {
  it('prefers the tenant’s own file', () => {
    expect(tenantFileFor(['beta.json', 'alpha.json', 'README.md'], 'beta')).toEqual({
      file: 'beta.json',
      template: false,
    });
  });

  it('falls back to the first shipped file for a key the dataset does not know', () => {
    expect(tenantFileFor(['beta.json', 'alpha.json'], 'gamma')).toEqual({
      file: 'alpha.json',
      template: true,
    });
  });

  it('returns null when the folder has no tenant files', () => {
    expect(tenantFileFor(['README.md'], 'gamma')).toBeNull();
  });
});

describe('retargetTenantDataset', () => {
  it('rewrites the key, the hostname and the employee e-mails', () => {
    const gamma = retargetTenantDataset(alpha, 'gamma', 'dcs.example.com');
    expect(gamma.key).toBe('gamma');
    expect(gamma.hostname).toBe('gamma.dcs.example.com');
    expect(gamma.employees[0]!.email).toBe('amira.haddad@gamma.demo');
    expect(gamma.name).toBe(alpha.name);
    expect(alpha.key).toBe('alpha');
  });

  it('defaults the hostname to <key>.localhost for local stacks', () => {
    expect(retargetTenantDataset(alpha, 'gamma').hostname).toBe('gamma.localhost');
  });
});
