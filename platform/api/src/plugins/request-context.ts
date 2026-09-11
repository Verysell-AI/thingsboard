import { fastifyRequestContext } from '@fastify/request-context';
import fp from 'fastify-plugin';
import { emptyContext } from '../lib/context.js';

/** Per-request store (tenant, user, request id) readable by services via getContext(). */
export default fp(
  async (fastify) => {
    await fastify.register(fastifyRequestContext, {
      defaultStoreValues: (req) => ({ ...emptyContext(req.id), ip: req.ip ?? null }),
    });
  },
  { name: 'request-context', dependencies: ['config'] },
);
