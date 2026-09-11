import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  IdSchema,
  ProblemDetailsSchema,
  RoomDetailSchema,
  RoomsQuerySchema,
  RoomsResponseSchema,
  UtilisationQuerySchema,
  UtilisationReportSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

function energyTenant(t: { id: string; key: string; tariffPerKwh: string }) {
  return { id: t.id, key: t.key, tariffPerKwh: Number(t.tariffPerKwh) };
}

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('rooms.read')],
      schema: {
        tags: ['rooms'],
        security: bearer,
        querystring: RoomsQuerySchema,
        response: { 200: RoomsResponseSchema },
      },
    },
    async (request) => ({
      items: await fastify.services.rooms.list(energyTenant(request.tenant!), request.query),
    }),
  );

  fastify.get(
    '/utilisation',
    {
      preHandler: [requireAccess('rooms.read')],
      schema: {
        tags: ['rooms'],
        security: bearer,
        querystring: UtilisationQuerySchema,
        response: { 200: UtilisationReportSchema },
      },
    },
    async (request) =>
      fastify.services.utilisation.report(
        request.tenant!,
        request.query.weeks,
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.get(
    '/:id',
    {
      preHandler: [requireAccess('rooms.read')],
      schema: {
        tags: ['rooms'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: RoomDetailSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.rooms.detail(energyTenant(request.tenant!), request.params.id),
  );
};

export default routes;
