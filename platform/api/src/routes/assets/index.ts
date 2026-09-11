import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  FleetReportSchema,
  AssetDetailSchema,
  AssetFacetsSchema,
  AssetSchema,
  AssetsQuerySchema,
  AssetsResponseSchema,
  CommandRequestSchema,
  CommandSchema,
  HistoryQuerySchema,
  HistoryResponseSchema,
  IdSchema,
  ProblemDetailsSchema,
  UpdateAssetSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';
import { planForRegister } from '../../services/reports/pdf.service.js';

const idParams = z.object({ id: IdSchema });
const bearer = [{ bearerAuth: [] }];

/** The asset register. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('assets.read')],
      schema: {
        tags: ['assets'],
        security: bearer,
        querystring: AssetsQuerySchema,
        response: { 200: AssetsResponseSchema, 403: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.assets.list(request.tenant!, request.query),
  );

  fastify.get(
    '/facets',
    {
      preHandler: [requireAccess('assets.read')],
      schema: { tags: ['assets'], security: bearer, response: { 200: AssetFacetsSchema } },
    },
    async (request) => fastify.services.assets.facets(request.tenant!.id),
  );

  fastify.get(
    '/export.pdf',
    {
      preHandler: [requireAccess('assets.read')],
      schema: { tags: ['assets'], security: bearer, querystring: AssetsQuerySchema },
    },
    async (request, reply) => {
      const tenant = request.tenant!;
      const page = await fastify.services.assets.list(tenant, {
        ...request.query,
        page: 0,
        pageSize: 1000,
      });
      const now = await fastify.services.clock.now(tenant.key);
      const pdf = await fastify.services.pdf.render(
        tenant.brand,
        planForRegister(page.items, tenant.currency, new Date(now).toISOString().slice(0, 10)),
      );
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${tenant.key}-asset-register.pdf"`)
        .send(pdf);
    },
  );

  fastify.get(
    '/fleet',
    {
      preHandler: [requireAccess('assets.read')],
      schema: { tags: ['assets'], security: bearer, response: { 200: FleetReportSchema } },
    },
    async (request) =>
      fastify.services.fleet.report(
        request.tenant!,
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.get(
    '/:id',
    {
      preHandler: [requireAccess('assets.read')],
      schema: {
        tags: ['assets'],
        security: bearer,
        params: idParams,
        response: { 200: AssetDetailSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.assets.detail(request.tenant!, request.params.id),
  );

  fastify.patch(
    '/:id',
    {
      preHandler: [requireAccess('assets.update')],
      schema: {
        tags: ['assets'],
        security: bearer,
        params: idParams,
        body: UpdateAssetSchema,
        response: { 200: AssetSchema, 403: ProblemDetailsSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.assets.update(request.tenant!, request.params.id, request.body),
  );

  fastify.post(
    '/:id/commands',
    {
      preHandler: [requireAccess('assets.command')],
      schema: {
        tags: ['assets'],
        security: bearer,
        params: idParams,
        body: CommandRequestSchema,
        response: {
          201: CommandSchema,
          400: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          502: ProblemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const command = await fastify.services.assets.command(
        request.tenant!,
        request.params.id,
        request.body.method,
        request.body.params,
        { source: 'USER', actorUserId: request.user.sub },
      );
      return reply.code(201).send(command);
    },
  );

  fastify.get(
    '/:id/history',
    {
      preHandler: [requireAccess('assets.history')],
      schema: {
        tags: ['assets'],
        security: bearer,
        params: idParams,
        querystring: HistoryQuerySchema,
        response: {
          200: HistoryResponseSchema,
          400: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) =>
      fastify.services.assets.history(request.tenant!, request.params.id, request.query),
  );
};

export default routes;
