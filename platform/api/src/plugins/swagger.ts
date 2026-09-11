import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

/** OpenAPI generated from the same Zod schemas that validate requests; UI at /docs. */
export default fp(
  async (fastify) => {
    await fastify.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: { title: 'Platform API', version: '0.1.0' },
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });
    await fastify.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger', dependencies: ['config'] },
);
