import { beforeEach, describe, expect, it } from 'vitest';
import { tenantKeyOverride } from '~/lib/api';

describe('tenantKeyOverride', () => {
  beforeEach(() => sessionStorage.clear());
  it('remembers ?tenant= for the tab and answers null without one', () => {
    expect(tenantKeyOverride('')).toBeNull();
    expect(tenantKeyOverride('?tenant=alpha&lang=ar')).toBe('alpha');
    expect(tenantKeyOverride('')).toBe('alpha');
    expect(tenantKeyOverride('?tenant=beta')).toBe('beta');
  });
});
