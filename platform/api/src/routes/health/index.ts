import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  HealthResponseSchema,
  ProblemDetailsSchema,
  type HealthResponse,
} from '@platform/shared/dto';
import { notFound } from '../../lib/errors.js';

const started = Date.now();

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '',
    {
      schema: {
        tags: ['health'],
        response: { 200: HealthResponseSchema, 503: HealthResponseSchema },
      },
    },
    async (_request, reply) => {
      const { services } = fastify;
      const [postgres, redis, thingsboard] = await Promise.all([
        services.db.app
          .execute(sql`select 1`)
          .then(() => 'ok' as const)
          .catch(() => 'fail' as const),
        services.redis
          .ping()
          .then(() => 'ok' as const)
          .catch(() => 'fail' as const),
        services.tb.reachable().then((ok) => (ok ? ('ok' as const) : ('fail' as const))),
      ]);
      const body: HealthResponse = {
        status: postgres === 'ok' && redis === 'ok' && thingsboard === 'ok' ? 'ok' : 'degraded',
        checks: { postgres, redis, thingsboard },
        version: '0.1.0',
        uptimeSeconds: Math.round((Date.now() - started) / 1000),
      };
      return reply.code(body.status === 'ok' ? 200 : 503).send(body);
    },
  );

  // The TLS proxy asks before issuing an on-demand certificate: only the console host and the
  // hostnames of existing tenants are ours. No auth on purpose (the proxy sends none); it leaks nothing
  // beyond "this hostname is served here".
  fastify.get(
    '/hostname',
    {
      schema: {
        tags: ['health'],
        description: 'Answers 200 when the hostname belongs to this deployment',
        querystring: z.object({ domain: z.string().min(1).max(253) }),
        response: { 200: z.object({ host: z.string() }), 404: ProblemDetailsSchema },
      },
    },
    async (request) => {
      const domain = request.query.domain.toLowerCase();
      const { config, tenants } = fastify.services;
      if (domain === config.PLATFORM_HOST.toLowerCase() || (await tenants.byHostname(domain))) {
        return { host: domain };
      }
      throw notFound('Unknown hostname');
    },
  );
};

export default routes;
