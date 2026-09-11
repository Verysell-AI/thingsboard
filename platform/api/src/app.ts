import { join } from 'node:path';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import cors from '@fastify/cors';
import type { FastifyPluginAsync, FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import type { Container, ContainerDeps } from './container.js';

export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {
  config?: Config;
  container?: Container;
  containerDeps?: ContainerDeps;
  skipLiveRebuild?: boolean;
}

const options: AppOptions = {};

/**
 * Root plugin (fastify-cli convention): Zod compilers, then every plugin in plugins/, then every
 * route folder in routes/ with the folder path as URL prefix.
 */
const app: FastifyPluginAsync<AppOptions> = async (fastify, opts): Promise<void> => {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  await fastify.register(cors, { origin: true, credentials: true });

  await fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, 'plugins'),
    forceESM: true,
    ignorePattern: /\.(test|d)\.(js|ts)$/,
    options: opts,
  });

  await fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, 'routes'),
    forceESM: true,
    ignorePattern: /\.(test|d)\.(js|ts)$/,
    dirNameRoutePrefix: true,
    options: {},
  });
};

export default app;
export { app, options };
