import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  LoginRequestSchema,
  ProblemDetailsSchema,
  RefreshRequestSchema,
  TokenPairSchema,
} from '@platform/shared/dto';

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        body: LoginRequestSchema,
        response: { 200: TokenPairSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.auth!.login(request.tenant!, request.body.email, request.body.password),
  );

  fastify.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        body: RefreshRequestSchema,
        response: { 200: TokenPairSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.auth!.refresh(request.tenant!, request.body.refreshToken),
  );
};

export default routes;
