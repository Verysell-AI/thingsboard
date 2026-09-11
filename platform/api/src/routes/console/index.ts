import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ProblemDetailsSchema,
  ScenarioNameSchema,
  ScenarioParamsSchema,
  ScenarioResultSchema,
  SimulatorStateSchema,
} from '@platform/shared/dto';
import { requireAuth, requireDemoMode, requireRole } from '../../hooks/index.js';
import { badRequest } from '../../lib/errors.js';

/** Scenario console: only tenant admins of tenants in demo mode; proxies to the simulator. */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireDemoMode);
  fastify.addHook('preHandler', requireRole('TENANT_ADMIN'));

  fastify.post(
    '/scenario/:name',
    {
      schema: {
        tags: ['console'],
        security: [{ bearerAuth: [] }],
        params: z.object({ name: ScenarioNameSchema }),
        body: ScenarioParamsSchema.optional(),
        response: {
          200: ScenarioResultSchema,
          501: ProblemDetailsSchema,
          502: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const params = request.body ?? {};
      // A ghost meeting is a booking, so the platform creates it itself; the simulator then keeps
      // the room empty because GHOST bookings bring nobody.
      if (request.params.name === 'ghost-meeting') {
        if (!params.room) throw badRequest('room is required');
        const booking = await fastify.services.bookings.createGhostMeeting(
          request.tenant!,
          params.room,
        );
        return {
          scenario: 'ghost-meeting' as const,
          accepted: true,
          message: `Ghost meeting booked in ${booking.roomCode} from ${booking.start} to ${booking.end}`,
          details: {
            bookingId: booking.id,
            room: booking.roomCode,
            start: booking.start,
            end: booking.end,
          },
        };
      }
      return fastify.services.console.runScenario(request.tenant!.key, request.params.name, params);
    },
  );

  fastify.get(
    '/state',
    {
      schema: {
        tags: ['console'],
        security: [{ bearerAuth: [] }],
        response: { 200: SimulatorStateSchema },
      },
    },
    async (request) => fastify.services.console.state(request.tenant!.key),
  );
};

export default routes;
