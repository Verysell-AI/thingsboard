import { describe, expect, it } from 'vitest';
import { ROLES } from '@platform/shared/roles';
import { RBAC_MATRIX, canAccess, rolesFor, type RouteKey } from './rbac.matrix.js';

describe('RBAC matrix', () => {
  const keys = Object.keys(RBAC_MATRIX) as RouteKey[];

  it('tenant admins may do everything', () => {
    for (const key of keys) expect(canAccess('TENANT_ADMIN', key)).toBe(true);
  });

  it('ops managers may do everything except users, branding and the console', () => {
    for (const key of keys) {
      const allowed = canAccess('OPS_MANAGER', key);
      const restricted = key === 'users.manage' || key === 'console.use' || key === 'clock.write';
      expect(allowed).toBe(!restricted);
    }
  });

  it('field operators read, command devices and manage bookings, nothing else', () => {
    expect(canAccess('FIELD_OPERATOR', 'assets.command')).toBe(true);
    expect(canAccess('FIELD_OPERATOR', 'bookings.create')).toBe(true);
    expect(canAccess('FIELD_OPERATOR', 'assets.update')).toBe(false);
    expect(canAccess('FIELD_OPERATOR', 'employees.create')).toBe(false);
    expect(canAccess('FIELD_OPERATOR', 'audit.read')).toBe(false);
  });

  it('finance sees reports, energy and notifications only', () => {
    const finance = keys.filter((k) => canAccess('FINANCE', k)).sort();
    expect(finance).toEqual(
      [
        'clock.read',
        'energy.read',
        'notifications.act',
        'notifications.read',
        'reports.read',
      ].sort(),
    );
  });

  it('viewers only read', () => {
    for (const key of keys) {
      const write = /\.(update|create|cancel|command|write|manage|run|use)$/.test(key);
      if (write) expect(canAccess('VIEWER', key)).toBe(false);
    }
    expect(canAccess('VIEWER', 'assets.read')).toBe(true);
    expect(canAccess('VIEWER', 'rooms.read')).toBe(true);
  });

  it('every entry lists known roles only', () => {
    for (const key of keys) for (const r of rolesFor(key)) expect(ROLES).toContain(r);
  });
});
