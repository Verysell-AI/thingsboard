import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformAccessClaims } from '@platform/shared/dto';
import { setContext } from '../lib/context.js';
import { unauthorized } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requirePlatformAdmin on /admin routes; tenant routes never see it. */
    platformAdmin?: PlatformAccessClaims;
  }
}

/** Accepts only platform-scoped access tokens, so a tenant user's token cannot reach /admin. */
export async function requirePlatformAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Missing or invalid token');
  const claims = request.server.services.platformAdmins.verifyAccess(token);
  request.platformAdmin = claims;
  setContext({ userId: claims.sub, userEmail: claims.email });
}
