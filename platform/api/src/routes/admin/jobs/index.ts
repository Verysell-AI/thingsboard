import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AdminJobSchema, ProblemDetailsSchema } from '@platform/shared/dto';
import { requirePlatformAdmin } from '../../../hooks/index.js';
import { notFound } from '../../../lib/errors.js';

const bearer = [{ bearerAuth: [] }];

/** Progress of a provisioning task; the console polls this while the job runs. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get(
    '/:id',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: z.object({ id: z.string().min(1) }),
        response: { 200: AdminJobSchema, 401: ProblemDetailsSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => {
      const job = await fastify.services.adminJobs.get(request.params.id);
      if (!job) throw notFound('Unknown job');
      return job;
    },
  );
};

export default routes;
