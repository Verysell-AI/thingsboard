import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ClockCommandSchema, ClockSnapshotSchema } from '@platform/shared/clock';
import { ProblemDetailsSchema } from '@platform/shared/dto';
import { requireAuth, requireDemoMode, requireRole } from '../../hooks/index.js';

/**
 * Tenant business clock (time machine). Readable by every signed-in user of a tenant in demo mode
 * so the header clock can follow it; only tenant admins move it. Tenants outside demo mode see 404.
 */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireDemoMode);

  fastify.get(
    '',
    {
      schema: {
        tags: ['clock'],
        security: [{ bearerAuth: [] }],
        response: { 200: ClockSnapshotSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.clock.snapshot(request.tenant!.key),
  );

  fastify.post(
    '',
    {
      preHandler: [requireRole('TENANT_ADMIN')],
      schema: {
        tags: ['clock'],
        security: [{ bearerAuth: [] }],
        body: ClockCommandSchema,
        response: {
          200: ClockSnapshotSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          502: ProblemDetailsSchema,
        },
      },
    },
    async (request) => fastify.services.clock.apply(request.tenant!.key, request.body),
  );
};

export default routes;
