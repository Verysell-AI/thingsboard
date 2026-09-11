import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateEmployeeResponseSchema,
  CreateEmployeeSchema,
  EmployeeSchema,
  EmployeesResponseSchema,
  IdSchema,
  ProblemDetailsSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('employees.read')],
      schema: { tags: ['employees'], security: bearer, response: { 200: EmployeesResponseSchema } },
    },
    async (request) => ({ items: await fastify.services.employees.list(request.tenant!.id) }),
  );

  fastify.get(
    '/:id',
    {
      preHandler: [requireAccess('employees.read')],
      schema: {
        tags: ['employees'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: EmployeeSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.employees.byId(request.tenant!.id, request.params.id),
  );

  fastify.post(
    '',
    {
      preHandler: [requireAccess('employees.create')],
      schema: {
        tags: ['employees'],
        security: bearer,
        body: CreateEmployeeSchema,
        response: {
          201: CreateEmployeeResponseSchema,
          400: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
          502: ProblemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await fastify.services.employees.create(request.tenant!, request.body);
      return reply.code(201).send(result);
    },
  );
};

export default routes;
