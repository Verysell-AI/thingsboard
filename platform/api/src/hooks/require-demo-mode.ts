import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from '../lib/errors.js';

/** Demo-only features look non-existent for tenants that are not in demo mode. */
export async function requireDemoMode(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!request.tenant?.demoMode) throw notFound('Not found');
}
