import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  LoginRequestSchema,
  PlatformAdminSchema,
  ProblemDetailsSchema,
  RefreshRequestSchema,
  TokenPairSchema,
} from '@platform/shared/dto';
import { requirePlatformAdmin } from '../../../hooks/index.js';
import { toPlatformAdmin } from '../../../services/admin/platform-admins.service.js';
import { unauthorized } from '../../../lib/errors.js';

const bearer = [{ bearerAuth: [] }];

/** Sign-in for platform operators; unlike /auth these routes have no tenant. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/login',
    {
      schema: {
        tags: ['admin'],
        body: LoginRequestSchema,
        response: { 200: TokenPairSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.platformAdmins.login(request.body.email, request.body.password),
  );

  fastify.post(
    '/refresh',
    {
      schema: {
        tags: ['admin'],
        body: RefreshRequestSchema,
        response: { 200: TokenPairSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.platformAdmins.refresh(request.body.refreshToken),
  );

  fastify.get(
    '/me',
    {
      preHandler: [requirePlatformAdmin],
      schema: {
        tags: ['admin'],
        security: bearer,
        response: { 200: PlatformAdminSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) => {
      const admin = await fastify.services.platformAdmins.byId(request.platformAdmin!.sub);
      if (!admin) throw unauthorized('Unknown platform admin');
      return toPlatformAdmin(admin);
    },
  );
};

export default routes;
