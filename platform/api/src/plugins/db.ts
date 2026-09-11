import fp from 'fastify-plugin';
import type { Db } from '../db/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** RLS-restricted database handle; use withTenant() for every query. */
    db: Db;
  }
}

export default fp(
  async (fastify) => {
    fastify.decorate('db', fastify.services.db.app);
  },
  { name: 'db', dependencies: ['services'] },
);
