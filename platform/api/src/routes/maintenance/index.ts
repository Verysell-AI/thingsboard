import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateMaintenanceTaskSchema,
  IdSchema,
  MaintenanceQuerySchema,
  MaintenanceResponseSchema,
  MaintenanceTaskSchema,
  ProblemDetailsSchema,
  UpdateMaintenanceTaskSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

/** Maintenance tasks on assets, opened by people or by alarms. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('maintenance.read')],
      schema: {
        tags: ['maintenance'],
        security: bearer,
        querystring: MaintenanceQuerySchema,
        response: { 200: MaintenanceResponseSchema },
      },
    },
    async (request) => fastify.services.maintenance.list(request.tenant!.id, request.query),
  );

  fastify.get(
    '/:id',
    {
      preHandler: [requireAccess('maintenance.read')],
      schema: {
        tags: ['maintenance'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: MaintenanceTaskSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.maintenance.byId(request.tenant!.id, request.params.id),
  );

  fastify.post(
    '',
    {
      preHandler: [requireAccess('maintenance.manage')],
      schema: {
        tags: ['maintenance'],
        security: bearer,
        body: CreateMaintenanceTaskSchema,
        response: { 201: MaintenanceTaskSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request, reply) => {
      const task = await fastify.services.maintenance.create(request.tenant!, request.body);
      return reply.code(201).send(task);
    },
  );

  fastify.patch(
    '/:id',
    {
      preHandler: [requireAccess('maintenance.manage')],
      schema: {
        tags: ['maintenance'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        body: UpdateMaintenanceTaskSchema,
        response: { 200: MaintenanceTaskSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.maintenance.update(request.tenant!, request.params.id, request.body),
  );
};

export default routes;
