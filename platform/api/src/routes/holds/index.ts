import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateHoldSchema,
  HoldSchema,
  HoldsResponseSchema,
  IdSchema,
  ProblemDetailsSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

/** Holds that keep a zone, floor or room on regardless of the automations. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('automations.read')],
      schema: { tags: ['holds'], security: bearer, response: { 200: HoldsResponseSchema } },
    },
    async (request) => ({ items: await fastify.services.holds.list(request.tenant!) }),
  );

  fastify.post(
    '',
    {
      preHandler: [requireAccess('automations.manage')],
      schema: {
        tags: ['holds'],
        security: bearer,
        body: CreateHoldSchema,
        response: { 201: HoldSchema, 400: ProblemDetailsSchema },
      },
    },
    async (request, reply) => {
      const hold = await fastify.services.holds.create(request.tenant!, request.body);
      return reply.code(201).send(hold);
    },
  );

  fastify.delete(
    '/:id',
    {
      preHandler: [requireAccess('automations.manage')],
      schema: {
        tags: ['holds'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 204: z.null(), 404: ProblemDetailsSchema },
      },
    },
    async (request, reply) => {
      await fastify.services.holds.delete(request.tenant!, request.params.id);
      return reply.code(204).send(null);
    },
  );
};

export default routes;
