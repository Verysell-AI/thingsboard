import { describe, expect, it } from 'vitest';
import { CreateTenantRequestSchema, UpdateTenantRequestSchema } from '../src/dto/admin.js';

describe('tenant console requests', () => {
  it('fills the settings a new tenant needs', () => {
    const parsed = CreateTenantRequestSchema.parse({ key: 'gamma', name: 'Gamma Group' });
    expect(parsed).toMatchObject({
      key: 'gamma',
      locale: 'en',
      currency: 'AED',
      tariffPerKwh: 0.44,
      demoMode: false,
    });
    expect(parsed.hostname).toBeUndefined();
  });

  it('leaves every settings field alone when an edit only touches the brand', () => {
    const parsed = UpdateTenantRequestSchema.parse({ brand: { primaryColor: '#DC2626' } });
    expect(parsed).toEqual({ brand: { primaryColor: '#DC2626' } });
  });

  it('keeps the fields an edit does set', () => {
    expect(UpdateTenantRequestSchema.parse({ demoMode: true })).toEqual({ demoMode: true });
  });
});
