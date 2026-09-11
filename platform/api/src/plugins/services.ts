import fp from 'fastify-plugin';
import { buildContainer, type Container, type ContainerDeps } from '../container.js';

declare module 'fastify' {
  interface FastifyInstance {
    services: Container;
  }
}

export interface ServicesPluginOptions {
  /** Pre-built container (tests) or dependency overrides. */
  container?: Container;
  containerDeps?: ContainerDeps;
}

/** Builds the typed services container once and exposes it as fastify.services. */
export default fp<ServicesPluginOptions>(
  async (fastify, opts) => {
    const container = opts.container ?? buildContainer(fastify.config, opts.containerDeps);
    fastify.decorate('services', container);
    if (!opts.container) {
      fastify.addHook('onClose', async () => {
        await container.close();
      });
    }
  },
  { name: 'services', dependencies: ['config', 'request-context'] },
);
