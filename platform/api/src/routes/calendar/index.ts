import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CalendarResponseSchema, parseAutomationParams } from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

/** Warranty ends, ends of life and holidays in the next ninety days. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('assets.read')],
      schema: {
        tags: ['assets'],
        security: [{ bearerAuth: [] }],
        response: { 200: CalendarResponseSchema },
      },
    },
    async (request) => {
      const tenant = request.tenant!;
      const now = await fastify.services.clock.now(tenant.key);
      const holiday = (await fastify.services.automations.list(tenant)).find(
        (a) => a.key === 'holiday_mode',
      );
      const holidays = holiday ? parseAutomationParams('holiday_mode', holiday.params).dates : [];
      return fastify.services.depreciation.calendar(tenant, now, holidays);
    },
  );
};

export default routes;
