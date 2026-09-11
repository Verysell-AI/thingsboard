import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AcHealthReportSchema,
  EnergyBreakdownSchema,
  IdSchema,
  StandbyAckSchema,
  StandbyReportSchema,
  EnergySummarySchema,
  EnergyTrendQuerySchema,
  EnergyTrendSchema,
  ProblemDetailsSchema,
  TopConsumersSchema,
} from '@platform/shared/dto';
import type { TenantRow } from '../../db/schema/index.js';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

function energyTenant(t: TenantRow) {
  return { id: t.id, key: t.key, currency: t.currency, tariffPerKwh: Number(t.tariffPerKwh) };
}

/** Energy figures from the meters: headline numbers, per floor/room, top consumers, trends. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireAccess('energy.read'));

  fastify.get(
    '/standby',
    { schema: { tags: ['energy'], security: bearer, response: { 200: StandbyReportSchema } } },
    async (request) =>
      fastify.services.standby.report(
        energyTenant(request.tenant!),
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.post(
    '/standby/:assetId/ack',
    {
      preHandler: [requireAccess('standby.ack')],
      schema: {
        tags: ['energy'],
        security: bearer,
        params: z.object({ assetId: IdSchema }),
        body: StandbyAckSchema,
        response: { 200: StandbyReportSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => {
      await fastify.services.standby.acknowledge(
        request.tenant!,
        request.params.assetId,
        request.body,
        request.user.sub,
      );
      return fastify.services.standby.report(
        energyTenant(request.tenant!),
        await fastify.services.clock.now(request.tenant!.key),
      );
    },
  );

  fastify.get(
    '/ac-health',
    { schema: { tags: ['energy'], security: bearer, response: { 200: AcHealthReportSchema } } },
    async (request) =>
      fastify.services.acHealth.report(
        request.tenant!,
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.get(
    '/summary',
    { schema: { tags: ['energy'], security: bearer, response: { 200: EnergySummarySchema } } },
    async (request) => fastify.services.energy.summary(energyTenant(request.tenant!)),
  );

  fastify.get(
    '/breakdown',
    {
      schema: {
        tags: ['energy'],
        security: bearer,
        querystring: z.object({
          scope: z.enum(['floor', 'room']).default('floor'),
          floor: z.coerce.number().int().optional(),
        }),
        response: { 200: EnergyBreakdownSchema },
      },
    },
    async (request) =>
      fastify.services.energy.breakdown(
        energyTenant(request.tenant!),
        request.query.scope,
        request.query.floor,
      ),
  );

  fastify.get(
    '/top',
    {
      schema: {
        tags: ['energy'],
        security: bearer,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(5) }),
        response: { 200: TopConsumersSchema },
      },
    },
    async (request) =>
      fastify.services.energy.top(energyTenant(request.tenant!), request.query.limit),
  );

  fastify.get(
    '/trend',
    {
      schema: {
        tags: ['energy'],
        security: bearer,
        querystring: EnergyTrendQuerySchema,
        response: {
          200: EnergyTrendSchema,
          400: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) =>
      fastify.services.energy.trend(
        energyTenant(request.tenant!),
        request.query.scope,
        request.query.code,
        request.query.range,
      ),
  );
};

export default routes;
