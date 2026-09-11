import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AutomationKeySchema,
  AutomationRunSchema,
  AutomationRunsQuerySchema,
  AutomationRunsResponseSchema,
  AutomationSchema,
  AutomationsResponseSchema,
  PeakStateResponseSchema,
  ProblemDetailsSchema,
  RunAutomationSchema,
  UpdateAutomationSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

function engineTenant(t: { id: string; key: string; tariffPerKwh: string; demoMode: boolean }) {
  return { id: t.id, key: t.key, tariffPerKwh: Number(t.tariffPerKwh), demoMode: t.demoMode };
}

/** Automations: what runs, with which parameters, and what each run decided. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('automations.read')],
      schema: {
        tags: ['automations'],
        security: bearer,
        response: { 200: AutomationsResponseSchema },
      },
    },
    async (request) => ({ items: await fastify.services.automations.list(request.tenant!.id) }),
  );

  fastify.get(
    '/runs',
    {
      preHandler: [requireAccess('automations.read')],
      schema: {
        tags: ['automations'],
        security: bearer,
        querystring: AutomationRunsQuerySchema,
        response: { 200: AutomationRunsResponseSchema },
      },
    },
    async (request) => fastify.services.automations.runs(request.tenant!.id, request.query),
  );

  fastify.get(
    '/peak/state',
    {
      preHandler: [requireAccess('energy.read')],
      schema: {
        tags: ['automations'],
        security: bearer,
        response: { 200: PeakStateResponseSchema },
      },
    },
    async (request) => fastify.services.automations.peakState(engineTenant(request.tenant!)),
  );

  fastify.patch(
    '/:key',
    {
      preHandler: [requireAccess('automations.manage')],
      schema: {
        tags: ['automations'],
        security: bearer,
        params: z.object({ key: AutomationKeySchema }),
        body: UpdateAutomationSchema,
        response: { 200: AutomationSchema, 400: ProblemDetailsSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.automations.update(request.tenant!.id, request.params.key, request.body),
  );

  fastify.post(
    '/:key/run',
    {
      preHandler: [requireAccess('automations.run')],
      schema: {
        tags: ['automations'],
        security: bearer,
        params: z.object({ key: AutomationKeySchema }),
        body: RunAutomationSchema.optional(),
        response: {
          200: AutomationRunSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
        },
      },
    },
    async (request) =>
      fastify.services.automations.runNow(
        engineTenant(request.tenant!),
        request.params.key,
        request.body ?? {},
      ),
  );
};

export default routes;
