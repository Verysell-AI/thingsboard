import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AdminJobSchema,
  AdminTenantSchema,
  AdminTenantsResponseSchema,
  AdminUserSchema,
  AdminUsersResponseSchema,
  CreateAdminUserRequestSchema,
  CreateTenantRequestSchema,
  IdSchema,
  ProblemDetailsSchema,
  TenantKeySchema,
  UpdateAdminUserRequestSchema,
  UpdateTenantRequestSchema,
} from '@platform/shared/dto';
import type { FastifyRequest } from 'fastify';
import { requirePlatformAdmin } from '../../../hooks/index.js';
import { toAdminTenant } from '../../../services/admin/admin-tenants.service.js';

const bearer = [{ bearerAuth: [] }];
const keyParams = z.object({ key: TenantKeySchema });
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
};

/** The origin the console was reached on, so tenant links keep the same scheme and port. */
function origin(request: FastifyRequest): string | null {
  return request.headers.host ? `${request.protocol}://${request.headers.host}` : null;
}

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', requirePlatformAdmin);
  const admin = () => fastify.services.adminTenants;

  fastify.get(
    '',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        response: { 200: AdminTenantsResponseSchema, 401: ProblemDetailsSchema },
      },
    },
    async (request) => {
      const rows = await admin().list();
      return { items: rows.map((r) => toAdminTenant(r.tenant, r.userCount, origin(request))) };
    },
  );

  fastify.get(
    '/:key',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams,
        response: { 200: AdminTenantSchema, ...errors },
      },
    },
    async (request) => {
      const { tenant, userCount } = await admin().get(request.params.key);
      return toAdminTenant(tenant, userCount, origin(request));
    },
  );

  fastify.post(
    '',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        body: CreateTenantRequestSchema,
        response: { 202: AdminJobSchema, ...errors },
      },
    },
    async (request, reply) => {
      const job = await admin().create(request.body);
      return reply.code(202).send(job);
    },
  );

  fastify.patch(
    '/:key',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams,
        body: UpdateTenantRequestSchema,
        response: { 200: AdminTenantSchema, ...errors },
      },
    },
    async (request) => {
      const tenant = await admin().update(request.params.key, request.body);
      const { userCount } = await admin().get(tenant.key);
      return toAdminTenant(tenant, userCount, origin(request));
    },
  );

  fastify.delete(
    '/:key',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams,
        response: { 202: AdminJobSchema, ...errors },
      },
    },
    async (request, reply) => reply.code(202).send(await admin().remove(request.params.key)),
  );

  fastify.post(
    '/:key/dataset',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams,
        body: z.object({ dataset: z.string().min(1).max(60) }),
        response: { 202: AdminJobSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(202).send(await admin().loadDataset(request.params.key, request.body.dataset)),
  );

  fastify.get(
    '/:key/users',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams,
        response: { 200: AdminUsersResponseSchema, ...errors },
      },
    },
    async (request) => ({ items: await admin().users(request.params.key) }),
  );

  fastify.post(
    '/:key/users',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams,
        body: CreateAdminUserRequestSchema,
        response: { 201: AdminUserSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await admin().createUser(request.params.key, request.body)),
  );

  fastify.patch(
    '/:key/users/:id',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams.extend({ id: IdSchema }),
        body: UpdateAdminUserRequestSchema,
        response: { 200: AdminUserSchema, ...errors },
      },
    },
    async (request) => admin().updateUser(request.params.key, request.params.id, request.body),
  );

  fastify.delete(
    '/:key/users/:id',
    {
      schema: {
        tags: ['admin'],
        security: bearer,
        params: keyParams.extend({ id: IdSchema }),
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await admin().removeUser(request.params.key, request.params.id);
      return reply.code(204).send(null);
    },
  );
};

export default routes;
