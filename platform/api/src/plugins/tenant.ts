import fp from 'fastify-plugin';
import type { TenantRow } from '../db/schema/index.js';
import { setContext } from '../lib/context.js';
import { notFound } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Tenant resolved from the Host header (null only on tenant-less routes). */
    tenant: TenantRow | null;
  }
}

// /admin is the platform console: it has no tenant of its own and manages every tenant.
const TENANT_LESS = [/^\/health(\/|$)/, /^\/docs(\/|$)/, /^\/internal\//, /^\/admin(\/|$)/];

/** Resolves the tenant for every request from Host (or X-Tenant-Key in demo mode). */
export default fp(
  async (fastify) => {
    fastify.decorateRequest('tenant', null);
    fastify.addHook('onRequest', async (request) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (TENANT_LESS.some((re) => re.test(path))) return;
      const tenant = await fastify.services.tenantResolver.resolve({
        host: request.headers.host,
        tenantKeyHeader: request.headers['x-tenant-key'],
      });
      if (!tenant) throw notFound('Unknown tenant');
      request.tenant = tenant;
      setContext({ tenantId: tenant.id, tenantKey: tenant.key });
    });
  },
  { name: 'tenant', dependencies: ['services', 'request-context'] },
);
