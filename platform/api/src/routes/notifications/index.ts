import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  IdSchema,
  NotificationActRequestSchema,
  NotificationSchema,
  NotificationsQuerySchema,
  NotificationsResponseSchema,
  ProblemDetailsSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { requireAccess } from '../../hooks/rbac.matrix.js';

const bearer = [{ bearerAuth: [] }];

/** The signed-in user's notifications; every role has some. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('notifications.read')],
      schema: {
        tags: ['notifications'],
        security: bearer,
        querystring: NotificationsQuerySchema,
        response: { 200: NotificationsResponseSchema },
      },
    },
    async (request) =>
      fastify.services.notifications.list(request.tenant!.id, request.user.sub, request.query),
  );

  fastify.post(
    '/read-all',
    {
      preHandler: [requireAccess('notifications.read')],
      schema: {
        tags: ['notifications'],
        security: bearer,
        response: { 200: z.object({ updated: z.number().int() }) },
      },
    },
    async (request) => ({
      updated: await fastify.services.notifications.markAllRead(
        request.tenant!.id,
        request.user.sub,
      ),
    }),
  );

  fastify.post(
    '/:id/read',
    {
      preHandler: [requireAccess('notifications.read')],
      schema: {
        tags: ['notifications'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: NotificationSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.notifications.markRead(
        request.tenant!.id,
        request.user.sub,
        request.params.id,
      ),
  );

  fastify.post(
    '/:id/act',
    {
      preHandler: [requireAccess('notifications.act')],
      schema: {
        tags: ['notifications'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        body: NotificationActRequestSchema,
        response: { 200: NotificationSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.notifications.act(
        request.tenant!,
        request.user.sub,
        request.params.id,
        request.body.key,
      ),
  );
};

export default routes;
