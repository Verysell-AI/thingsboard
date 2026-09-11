import fp from 'fastify-plugin';
import { loadConfig, redactConfig, type Config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

export interface ConfigPluginOptions {
  config?: Config;
}

export default fp<ConfigPluginOptions>(
  async (fastify, opts) => {
    const config = opts.config ?? loadConfig();
    fastify.decorate('config', config);
    fastify.log.debug({ config: redactConfig(config) }, 'configuration loaded');
  },
  { name: 'config' },
);
