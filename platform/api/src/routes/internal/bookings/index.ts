import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BookingsNowResponseSchema } from '@platform/shared/dto';
import { requireInternalToken } from '../../../hooks/index.js';
import { notFound } from '../../../lib/errors.js';

/**
 * The simulator asks which meetings are on right now (business clock) to decide how many people
 * its occupancy sensors see. LATE meetings fill up LATE_ARRIVAL_MINUTES after `start`; GHOST ones
 * never do. The simulator applies that; this endpoint only reports the bookings.
 */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/now',
    {
      preHandler: [requireInternalToken],
      schema: {
        tags: ['internal'],
        hide: true,
        querystring: z.object({ tenant: z.string() }),
        response: { 200: BookingsNowResponseSchema },
      },
    },
    async (request) => {
      const tenant = await fastify.services.tenants.byKey(request.query.tenant);
      if (!tenant) throw notFound('Unknown tenant');
      return fastify.services.bookings.activeNow(tenant);
    },
  );
};

export default routes;
