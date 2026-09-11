import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AdminPlatformResponseSchema, ProblemDetailsSchema } from '@platform/shared/dto';
import { requirePlatformAdmin } from '../../../hooks/index.js';

const bearer = [{ bearerAuth: [] }];

/** Deployment-wide values for the console (default tenant hostname suffix, public API URL). */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get(
    '',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        response: { 200: AdminPlatformResponseSchema, 401: ProblemDetailsSchema },
      },
    },
    async () => {
      const { config } = fastify.services;
      return { host: config.PLATFORM_HOST, apiPublicUrl: config.API_PUBLIC_URL };
    },
  );
};

export default routes;
