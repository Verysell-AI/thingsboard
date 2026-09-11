import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  BookingSchema,
  BookingsQuerySchema,
  BookingsResponseSchema,
  CreateBookingSchema,
  ExtendBookingSchema,
  IdSchema,
  ProblemDetailsSchema,
} from '@platform/shared/dto';
import { requireAuth } from '../../hooks/index.js';
import { canAccess, requireAccess } from '../../hooks/rbac.matrix.js';
import { forbidden } from '../../lib/errors.js';

const bearer = [{ bearerAuth: [] }];

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get(
    '',
    {
      preHandler: [requireAccess('bookings.read')],
      schema: {
        tags: ['bookings'],
        security: bearer,
        querystring: BookingsQuerySchema,
        response: { 200: BookingsResponseSchema, 400: ProblemDetailsSchema },
      },
    },
    async (request) => ({
      items: await fastify.services.bookings.list(request.tenant!, request.query),
    }),
  );

  fastify.get(
    '/:id',
    {
      preHandler: [requireAccess('bookings.read')],
      schema: {
        tags: ['bookings'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: BookingSchema, 404: ProblemDetailsSchema },
      },
    },
    async (request) => fastify.services.bookings.byId(request.tenant!.id, request.params.id),
  );

  fastify.post(
    '',
    {
      preHandler: [requireAccess('bookings.create')],
      schema: {
        tags: ['bookings'],
        security: bearer,
        body: CreateBookingSchema,
        response: {
          201: BookingSchema,
          400: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const booking = await fastify.services.bookings.create(request.tenant!, request.body);
      return reply.code(201).send(booking);
    },
  );

  fastify.post(
    '/:id/cancel',
    {
      preHandler: [requireAccess('bookings.cancel')],
      schema: {
        tags: ['bookings'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: { 200: BookingSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema },
      },
    },
    async (request) =>
      fastify.services.bookings.setStatus(request.tenant!.id, request.params.id, 'CANCELLED'),
  );

  /** Organisers may release or extend their own booking; operations roles may do it for anyone. */
  async function assertOwnerOrOperations(request: FastifyRequest, bookingId: string) {
    const role = request.user.role;
    if (canAccess(role, 'bookings.cancel')) return;
    const booking = await fastify.services.bookings.byId(request.tenant!.id, bookingId);
    const me = await fastify.services.users.byId(request.tenant!.id, request.user.sub);
    if (!booking.organiser || !me?.employeeId || me.employeeId !== booking.organiser.id)
      throw forbidden('Only the organiser or operations may change this booking');
  }

  fastify.post(
    '/:id/release',
    {
      schema: {
        tags: ['bookings'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        response: {
          200: BookingSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      await assertOwnerOrOperations(request, request.params.id);
      return fastify.services.bookings.release(
        { id: request.tenant!.id, key: request.tenant!.key },
        request.params.id,
        'released from the room panel',
      );
    },
  );

  fastify.post(
    '/:id/extend',
    {
      schema: {
        tags: ['bookings'],
        security: bearer,
        params: z.object({ id: IdSchema }),
        body: ExtendBookingSchema.optional(),
        response: {
          200: BookingSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      await assertOwnerOrOperations(request, request.params.id);
      return fastify.services.bookings.extend(
        request.tenant!.id,
        request.params.id,
        request.body?.minutes ?? 30,
      );
    },
  );
};

export default routes;
