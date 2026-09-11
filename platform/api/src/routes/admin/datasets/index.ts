import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AdminDatasetsResponseSchema, ProblemDetailsSchema } from '@platform/shared/dto';
import { requirePlatformAdmin } from '../../../hooks/index.js';

const bearer = [{ bearerAuth: [] }];

/** Datasets the console can load into a tenant. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get(
    '',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        response: { 200: AdminDatasetsResponseSchema, 401: ProblemDetailsSchema },
      },
    },
    async () => ({ items: await fastify.services.adminTenants.datasets() }),
  );
};

export default routes;
