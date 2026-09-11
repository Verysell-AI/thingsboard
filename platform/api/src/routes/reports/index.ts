import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  EnergyCostQuerySchema,
  EnergyCostReportSchema,
  FinancialsReportSchema,
  IdSchema,
  ProblemDetailsSchema,
  ReportSchema,
  ReportsQuerySchema,
  ReportsResponseSchema,
  RunReportSchema,
  SavingsReportSchema,
} from '@platform/shared/dto';
import type { TenantRow } from '../../db/schema/index.js';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';
import { planForReport, reportFilename } from '../../services/reports/pdf.service.js';
import { MONTHLY_KINDS } from '../../services/reports/reports.service.js';

const bearer = [{ bearerAuth: [] }];

function view(t: TenantRow) {
  return { id: t.id, key: t.key, currency: t.currency, tariffPerKwh: Number(t.tariffPerKwh) };
}

/** Generated reports: the morning report now, monthly reports in later phases. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('reports.read')],
      schema: {
        tags: ['reports'],
        security: bearer,
        querystring: ReportsQuerySchema,
        response: { 200: ReportsResponseSchema },
      },
    },
    async (request) => fastify.services.morningReport.list(request.tenant!.id, request.query),
  );

  fastify.get(
    '/energy-cost',
    {
      preHandler: [requireAccess('reports.read')],
      schema: {
        tags: ['reports'],
        security: bearer,
        querystring: EnergyCostQuerySchema,
        response: { 200: EnergyCostReportSchema },
      },
    },
    async (request) =>
      fastify.services.allocation.report(
        view(request.tenant!),
        request.query.months,
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.get(
    '/savings',
    {
      preHandler: [requireAccess('reports.read')],
      schema: { tags: ['reports'], security: bearer, response: { 200: SavingsReportSchema } },
    },
    async (request) =>
      fastify.services.savings.report(
        view(request.tenant!),
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.get(
    '/asset-financials',
    {
      preHandler: [requireAccess('reports.read')],
      schema: { tags: ['reports'], security: bearer, response: { 200: FinancialsReportSchema } },
    },
    async (request) =>
      fastify.services.depreciation.financials(
        view(request.tenant!),
        await fastify.services.clock.now(request.tenant!.key),
      ),
  );

  fastify.post(
    '/:kind/run',
    {
      preHandler: [requireAccess('reports.generate')],
      schema: {
        tags: ['reports'],
        security: bearer,
        params: z.object({ kind: z.enum(MONTHLY_KINDS) }),
        body: RunReportSchema.optional(),
        response: { 200: ReportSchema, 400: ProblemDetailsSchema, 403: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.reportsSnapshots.generate(request.tenant!, request.params.kind, {
        period: request.body?.period,
        trigger: 'manual',
      }),
  );

  fastify.get(
    '/:id/pdf',
    {
      preHandler: [requireAccess('reports.read')],
      schema: {
        tags: ['reports'],
        security: bearer,
        params: z.object({ id: IdSchema }),
      },
    },
    async (request, reply) => {
      const tenant = request.tenant!;
      const report = await fastify.services.morningReport.byId(tenant.id, request.params.id);
      const pdf = await fastify.services.pdf.render(
        tenant.brand,
        planForReport(report, tenant.currency),
      );
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${reportFilename(tenant, report)}"`)
        .send(pdf);
    },
  );

  fastify.get(
    '/:id',
    {
      preHandler: [requireAccess('reports.read')],
      schema: {
        tags: ['reports'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: ReportSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.morningReport.byId(request.tenant!.id, request.params.id),
  );

  fastify.post(
    '/morning/run',
    {
      preHandler: [requireAccess('reports.generate')],
      schema: {
        tags: ['reports'],
        security: bearer,
        body: RunReportSchema.optional(),
        response: { 200: ReportSchema, 403: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.morningReport.generate(request.tenant!, {
        date: request.body?.period,
        trigger: 'manual',
      }),
  );
};

export default routes;
