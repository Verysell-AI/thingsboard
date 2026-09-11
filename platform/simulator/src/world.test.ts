import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTenantDataset } from './world.js';

const datasetsDir = resolve(import.meta.dirname, '../../datasets');

describe('loadTenantDataset', () => {
  it('reads the tenant’s own file when the dataset ships one', () => {
    const beta = loadTenantDataset(datasetsDir, 'office-demo', 'beta');
    expect(beta.key).toBe('beta');
    expect(beta.employees[0]!.email).toMatch(/@beta\.demo$/);
  });

  it('retargets the first shipped file for a tenant created in the console', () => {
    const gamma = loadTenantDataset(datasetsDir, 'office-demo', 'gamma');
    const alpha = loadTenantDataset(datasetsDir, 'office-demo', 'alpha');
    expect(gamma.key).toBe('gamma');
    expect(gamma.employees).toHaveLength(alpha.employees.length);
    expect(gamma.employees.every((e) => e.email.endsWith('@gamma.demo'))).toBe(true);
  });
});
