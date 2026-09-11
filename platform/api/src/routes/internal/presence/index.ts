import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireInternalToken } from '../../../hooks/index.js';
import { notFound } from '../../../lib/errors.js';

const PresenceResponseSchema = z.object({
  tenantKey: z.string(),
  rooms: z.array(
    z.object({
      room: z.string(),
      occupied: z.boolean(),
      count: z.number().int(),
      laptopsOnline: z.number().int(),
      laptopCodes: z.array(z.string()),
      emptySince: z.number().int().nullable(),
      updatedAt: z.number().int(),
    }),
  ),
});

/** Presence as the platform sees it, for the simulator and for debugging a demo. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/:tenantKey',
    {
      preHandler: [requireInternalToken],
      schema: {
        tags: ['internal'],
        hide: true,
        params: z.object({ tenantKey: z.string() }),
        response: { 200: PresenceResponseSchema },
      },
    },
    async (request) => {
      const tenant = await fastify.services.tenants.byKey(request.params.tenantKey);
      if (!tenant) throw notFound('Unknown tenant');
      const rooms = await fastify.services.presence.presence(tenant);
      return { tenantKey: tenant.key, rooms: [...rooms.values()] };
    },
  );
};

export default routes;
