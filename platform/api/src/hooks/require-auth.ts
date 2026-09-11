import type { FastifyReply, FastifyRequest } from 'fastify';
import { setContext } from '../lib/context.js';
import { notFound, unauthorized } from '../lib/errors.js';

/** Verifies the bearer token and checks it belongs to the request's tenant. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized('Missing or invalid token');
  }
  const claims = request.user;
  if (claims.type !== 'access') throw unauthorized('Access token required');
  // A token from another tenant must look like the entity does not exist here.
  if (!request.tenant || claims.tenantId !== request.tenant.id) throw notFound('Unknown tenant');
  setContext({ userId: claims.sub, userEmail: claims.email, role: claims.role });
}
