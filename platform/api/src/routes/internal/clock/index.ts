import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ClockSnapshotSchema } from '@platform/shared/clock';
import { requireInternalToken } from '../../../hooks/index.js';

/** The simulator pulls each tenant's business clock at startup (see simulator clock-sync). */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/:tenantKey',
    {
      preHandler: [requireInternalToken],
      schema: {
        tags: ['internal'],
        hide: true,
        params: z.object({ tenantKey: z.string() }),
        response: { 200: ClockSnapshotSchema },
      },
    },
    async (request) => fastify.services.clock.snapshot(request.params.tenantKey),
  );
};

export default routes;
