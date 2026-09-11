import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@platform/shared/roles';
import { requireRole } from './require-role.js';

const ALL: Role[] = ['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR', 'FINANCE', 'VIEWER'];
const OPERATIONS: Role[] = ['TENANT_ADMIN', 'OPS_MANAGER'];
const OPERATIONS_AND_FIELD: Role[] = ['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR'];
/** Everyone except Finance, who only sees reports, energy and their notifications. */
const NON_FINANCE: Role[] = ['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR', 'VIEWER'];

/**
 * The single access matrix: route key → roles allowed. Routes call `requireAccess(key)`; the demo
 * shows refusals on purpose, so every denial is audited by `requireRole`.
 *
 * TENANT_ADMIN: everything. OPS_MANAGER: everything except users, branding and the console.
 * FIELD_OPERATOR: reads, device commands, bookings. FINANCE: reports, energy, notifications.
 * VIEWER: reads only.
 */
export const RBAC_MATRIX = {
  'locations.read': NON_FINANCE,
  'assets.read': NON_FINANCE,
  'assets.update': OPERATIONS,
  'assets.command': OPERATIONS_AND_FIELD,
  'assets.history': NON_FINANCE,
  'employees.read': NON_FINANCE,
  'employees.create': OPERATIONS,
  'rooms.read': NON_FINANCE,
  'bookings.read': NON_FINANCE,
  'bookings.create': OPERATIONS_AND_FIELD,
  'bookings.cancel': OPERATIONS_AND_FIELD,
  'notifications.read': ALL,
  'notifications.act': ALL,
  'energy.read': ALL,
  'clock.read': ALL,
  'clock.write': ['TENANT_ADMIN'],
  'console.use': ['TENANT_ADMIN'],
  'automations.read': NON_FINANCE,
  'automations.manage': OPERATIONS,
  'automations.run': OPERATIONS_AND_FIELD,
  'reports.read': ['TENANT_ADMIN', 'OPS_MANAGER', 'FINANCE'],
  'reports.generate': OPERATIONS,
  'maintenance.read': NON_FINANCE,
  'maintenance.manage': OPERATIONS_AND_FIELD,
  'standby.ack': OPERATIONS,
  'audit.read': OPERATIONS,
  'users.manage': ['TENANT_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type RouteKey = keyof typeof RBAC_MATRIX;

export function rolesFor(key: RouteKey): readonly Role[] {
  return RBAC_MATRIX[key];
}

export function canAccess(role: Role, key: RouteKey): boolean {
  return (RBAC_MATRIX[key] as readonly Role[]).includes(role);
}

/** preHandler for a route key; refusals are audited as DENIED. Use after requireAuth. */
export function requireAccess(key: RouteKey) {
  const hook = requireRole(...RBAC_MATRIX[key]);
  return async function requireAccessHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    return hook(request, reply);
  };
}
