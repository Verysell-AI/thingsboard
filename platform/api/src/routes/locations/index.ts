import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  FloorPlanSchema,
  IdSchema,
  LocationSchema,
  LocationsQuerySchema,
  LocationsResponseSchema,
  ProblemDetailsSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireAccess('locations.read'));

  fastify.get(
    '',
    {
      schema: {
        tags: ['locations'],
        security: [{ bearerAuth: [] }],
        querystring: LocationsQuerySchema,
        response: { 200: LocationsResponseSchema },
      },
    },
    async (request) => ({
      items: await fastify.services.locations.list(request.tenant!.id, request.query),
    }),
  );

  fastify.get(
    '/floors/:floor/plan',
    {
      schema: {
        tags: ['locations'],
        security: [{ bearerAuth: [] }],
        params: z.object({ floor: z.coerce.number().int().min(1) }),
        response: { 200: FloorPlanSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.locations.floorPlan(request.tenant!.id, request.params.floor),
  );

  fastify.get(
    '/:id',
    {
      schema: {
        tags: ['locations'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: IdSchema }),
        response: { 200: LocationSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.locations.byId(request.tenant!.id, request.params.id),
  );
};

export default routes;
