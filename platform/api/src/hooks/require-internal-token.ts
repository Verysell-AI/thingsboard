import type { FastifyReply, FastifyRequest } from 'fastify';
import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import { unauthorized } from '../lib/errors.js';

/** Shared-secret check for calls from the ThingsBoard rule chain and the simulator. */
export async function requireInternalToken(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers[INTERNAL_TOKEN_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || token !== request.server.config.INTERNAL_API_TOKEN)
    throw unauthorized('Invalid internal token');
}
