import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MeResponseSchema, ProblemDetailsSchema, type MeResponse } from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { unauthorized } from '../../lib/errors.js';

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['me'],
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponseSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) => {
      const tenant = request.tenant!;
      const user = await fastify.services.users.byId(tenant.id, request.user.sub);
      if (!user) throw unauthorized('User no longer exists');
      const body: MeResponse = {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          employeeId: user.employeeId,
          displayName: user.displayName,
        },
        tenant: {
          id: tenant.id,
          key: tenant.key,
          name: tenant.name,
          hostname: tenant.hostname,
          locale: tenant.locale === 'ar' ? 'ar' : 'en',
          currency: tenant.currency,
          tariffPerKwh: Number(tenant.tariffPerKwh),
          demoMode: tenant.demoMode,
          timeZone: fastify.config.TIME_ZONE,
        },
      };
      return body;
    },
  );
};

export default routes;
