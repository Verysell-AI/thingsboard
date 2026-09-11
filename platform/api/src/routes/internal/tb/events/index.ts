import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TbEventPayloadSchema } from '@platform/shared/contracts';
import { requireInternalToken } from '../../../../hooks/index.js';

/** Ingress for the ThingsBoard rule chain's REST call node (context §6.5). */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '',
    {
      preHandler: [requireInternalToken],
      schema: { tags: ['internal'], hide: true, body: TbEventPayloadSchema },
    },
    async (request, reply) => {
      const result = await fastify.services.tbEvents.handle(request.body);
      if (result.outcome === 'ignored') {
        request.log.debug(
          { reason: result.reason, originator: request.body.originator.name },
          'tb event ignored',
        );
        return reply.code(202).send();
      }
      return reply.code(204).send();
    },
  );
};

export default routes;
