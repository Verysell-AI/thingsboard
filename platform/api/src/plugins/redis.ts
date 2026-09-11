import fp from 'fastify-plugin';
import type { RedisLike } from '../lib/redis.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: RedisLike;
  }
}

export default fp(
  async (fastify) => {
    fastify.decorate('redis', fastify.services.redis);
  },
  { name: 'redis', dependencies: ['services'] },
);
