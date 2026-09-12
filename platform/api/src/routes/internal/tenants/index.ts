import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SimulatedTenantsResponseSchema } from '@platform/shared/dto';
import { requireInternalToken } from '../../../hooks/index.js';

/** The simulator asks which tenants to drive at startup and re-checks periodically (tenant-sync). */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/simulated',
    {
      preHandler: [requireInternalToken],
      schema: {
        tags: ['internal'],
        hide: true,
        response: { 200: SimulatedTenantsResponseSchema },
      },
    },
    async () => ({
      items: (await fastify.services.tenants.simulated()).map((t) => ({ key: t.key })),
    }),
  );
};

export default routes;
