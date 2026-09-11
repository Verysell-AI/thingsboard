import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AuditFacetsSchema, AuditQuerySchema, AuditResponseSchema } from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

/** The tenant's audit trail: every command, automation decision, booking, asset change, login and denial. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireAccess('audit.read'));

  fastify.get(
    '',
    {
      schema: {
        tags: ['audit'],
        security: bearer,
        querystring: AuditQuerySchema,
        response: { 200: AuditResponseSchema },
      },
    },
    async (request) => fastify.services.auditQuery.list(request.tenant!.id, request.query),
  );

  fastify.get(
    '/facets',
    { schema: { tags: ['audit'], security: bearer, response: { 200: AuditFacetsSchema } } },
    async (request) => fastify.services.auditQuery.facets(request.tenant!.id),
  );

  fastify.get(
    '/export.csv',
    {
      schema: {
        tags: ['audit'],
        security: bearer,
        querystring: AuditQuerySchema.omit({ page: true, pageSize: true }),
      },
    },
    async (request, reply) => {
      const csv = await fastify.services.auditQuery.csv(request.tenant!.id, request.query);
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="audit-${request.tenant!.key}.csv"`)
        .send(csv);
    },
  );
};

export default routes;
