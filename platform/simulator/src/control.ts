import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import {
  ScenarioNameSchema,
  ScenarioParamsSchema,
  ScenarioResultSchema,
  SimulatorAddDeviceSchema,
  SimulatorSetClockSchema,
  SimulatorStateSchema,
} from '@platform/shared/dto';
import { ClockSnapshotSchema } from '@platform/shared/clock';
import type { Simulation } from './simulation.js';

export interface ControlOptions {
  internalToken: string;
  /** Used when a request does not name a tenant. */
  defaultTenant: string;
  logger?: boolean | object;
}

const TenantQuerySchema = z.object({ tenant: z.string().optional() });

/**
 * Internal control API. Every route except /health requires the shared internal token. Device and
 * scenario routes take `?tenant=<key>`; when omitted the first configured tenant is used.
 */
export function buildControlApp(sim: Simulation, opts: ControlOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);

  app.get('/health', async () => ({
    status: 'ok',
    tenants: sim.tenantKeys(),
    timeZone: sim.timeZone,
    clocks: sim.clocks(),
  }));

  app.register(async (instance) => {
    const secured = instance.withTypeProvider<ZodTypeProvider>();
    secured.addHook('preHandler', async (req, reply) => {
      const token = req.headers[INTERNAL_TOKEN_HEADER];
      if (token !== opts.internalToken) {
        return reply
          .code(401)
          .send({ title: 'Unauthorized', status: 401, detail: 'invalid internal token' });
      }
    });

    const resolveTenant = (tenant: string | undefined) => tenant ?? opts.defaultTenant;

    secured.get('/state', { schema: { response: { 200: SimulatorStateSchema } } }, async () =>
      sim.state(),
    );

    secured.post('/devices', { schema: { body: SimulatorAddDeviceSchema } }, async (req, reply) => {
      if (!sim.registry(req.body.tenant))
        return reply.notFound(`unknown tenant ${req.body.tenant}`);
      if (sim.registry(req.body.tenant)?.get(req.body.code)) {
        return reply.conflict(`device ${req.body.code} already exists`);
      }
      const link = sim.addRuntimeDevice(req.body);
      return reply
        .code(201)
        .send({ tenant: req.body.tenant, code: link.device.code, type: link.device.type });
    });

    secured.delete(
      '/devices/:code',
      { schema: { params: z.object({ code: z.string() }), querystring: TenantQuerySchema } },
      async (req, reply) => {
        const tenant = resolveTenant(req.query.tenant);
        if (!sim.removeDevice(tenant, req.params.code))
          return reply.notFound(`device ${req.params.code} not found`);
        return reply.code(204).send();
      },
    );

    secured.post(
      '/scenario/:name',
      {
        schema: {
          params: z.object({ name: z.string() }),
          querystring: TenantQuerySchema,
          body: ScenarioParamsSchema.extend({ tenant: z.string().optional() }).optional(),
          response: { 200: ScenarioResultSchema, 501: ScenarioResultSchema },
        },
      },
      async (req, reply) => {
        const parsedName = ScenarioNameSchema.safeParse(req.params.name);
        if (!parsedName.success) return reply.notFound(`unknown scenario ${req.params.name}`);
        const body = req.body ?? {};
        const tenant = resolveTenant(body.tenant ?? req.query.tenant);
        if (!sim.registry(tenant)) return reply.notFound(`unknown tenant ${tenant}`);
        const result = sim.scenario(tenant, parsedName.data, body);
        if (!result.accepted && result.message === 'not implemented in this phase') {
          return reply.code(501).send(result);
        }
        if (!result.accepted) return reply.badRequest(result.message);
        return result;
      },
    );

    /** The API pushes a tenant's business clock here (context §8.1). */
    secured.put(
      '/clock',
      { schema: { body: SimulatorSetClockSchema, response: { 200: ClockSnapshotSchema } } },
      async (req, reply) => {
        if (!sim.registry(req.body.tenant))
          return reply.notFound(`unknown tenant ${req.body.tenant}`);
        return sim.setClock(req.body.tenant, req.body.state);
      },
    );

    secured.get(
      '/clock',
      { schema: { querystring: TenantQuerySchema, response: { 200: ClockSnapshotSchema } } },
      async (req, reply) => {
        const snapshot = sim.clock(resolveTenant(req.query.tenant));
        if (!snapshot) return reply.notFound('unknown tenant');
        return snapshot;
      },
    );
  });

  return app;
}
