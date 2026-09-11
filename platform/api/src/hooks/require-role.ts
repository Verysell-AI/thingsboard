import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@platform/shared/roles';
import { withTenant } from '../db/tenant.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Allows only the listed roles. Refusals are audited as DENIED so the demo can show them.
 * Use after requireAuth.
 */
export function requireRole(...roles: Role[]) {
  return async function requireRoleHook(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const claims = request.user;
    if (!claims) throw unauthorized('Missing or invalid token');
    if (roles.includes(claims.role)) return;
    const { services } = request.server;
    if (request.tenant) {
      const tenantId = request.tenant.id;
      await withTenant(services.db.app, tenantId, (tx) =>
        services.audit.record(tx, {
          tenantId,
          action: 'DENIED',
          entityType: 'route',
          entityId: `${request.method} ${request.routeOptions.url ?? request.url}`,
          after: { role: claims.role, required: roles },
        }),
      ).catch((err) => request.log.warn({ err }, 'could not audit denial'));
    }
    throw forbidden(`Role ${claims.role} may not perform this action`);
  };
}
