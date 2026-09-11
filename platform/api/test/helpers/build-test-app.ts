import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Dispatcher } from 'undici';
import app from '../../src/app.js';
import { testConfig, type Config } from '../../src/config.js';
import { buildContainer, type Container } from '../../src/container.js';
import { createDb, type DbHandles } from '../../src/db/index.js';
import { locations, tenants, type TenantRow } from '../../src/db/schema/index.js';
import { withTenant, withoutTenant } from '../../src/db/tenant.js';
import { runWithContext } from '../../src/lib/context.js';
import type { TbClientRegistry } from '../../src/services/tb/tb-registry.js';
import { defaultBrand } from '../../src/services/tenants/tenants.service.js';

/**
 * Integration tests run against a real Postgres (superuser URL in TEST_DATABASE_URL) and Redis
 * (TEST_REDIS_URL). The helper migrates as superuser, gives the `app` role a password, and builds
 * the same root plugin the server uses, with ThingsBoard and the simulator replaced by fakes.
 */
export const integrationEnabled = Boolean(process.env.TEST_DATABASE_URL);
const APP_PASSWORD = 'app-test-password';

export interface RpcCall {
  tenantKey: string;
  deviceId: string;
  method: string;
  params: unknown;
}

export interface TbCall {
  tenantKey: string;
  method: string;
  args: unknown[];
}

export interface TestApp {
  fastify: FastifyInstance;
  container: Container;
  config: Config;
  db: DbHandles;
  alpha: TenantRow;
  beta: TenantRow;
  rpcCalls: RpcCall[];
  /** Every other call made to the fake ThingsBoard client (device registration, history). */
  tbCalls: TbCall[];
  /** Points returned by the fake `getTimeseries`, settable per test. */
  timeseries: Record<string, { ts: number; value: string }[]>;
  close(): Promise<void>;
}

function appUrl(superUrl: string): string {
  const u = new URL(superUrl);
  u.username = 'app';
  u.password = APP_PASSWORD;
  return u.toString();
}

async function resetSchema(superUrl: string): Promise<void> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: superUrl });
  await client.connect();
  await client.query(
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
  );
  await client.end();
}

export async function buildTestApp(
  opts: { simulatorDispatcher?: Dispatcher } = {},
): Promise<TestApp> {
  const superUrl = process.env.TEST_DATABASE_URL!;
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6381';
  await resetSchema(superUrl);

  const admin = createDb(superUrl, superUrl);
  await migrate(admin.admin, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  await admin.admin.execute(sql.raw(`ALTER ROLE app PASSWORD '${APP_PASSWORD}'`));
  await admin.close();

  const db = createDb(appUrl(superUrl), superUrl);
  const redis = new Redis(redisUrl);
  await redis.flushdb();

  const config = testConfig({
    DATABASE_URL: appUrl(superUrl),
    DATABASE_ADMIN_URL: superUrl,
    REDIS_URL: redisUrl,
    INTERNAL_API_TOKEN: 'test-internal-token',
    SIMULATOR_URL: 'http://simulator.test:4100',
    JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
  });

  const rpcCalls: RpcCall[] = [];
  const tbCalls: TbCall[] = [];
  const timeseries: TestApp['timeseries'] = {};
  let deviceSeq = 0;
  const fakeTb = {
    serviceEmail: (key: string) => `svc-api@${key}.demo`,
    sysadmin: () => {
      throw new Error('no ThingsBoard in tests');
    },
    forTenant: (tenantKey: string) => {
      const record = (method: string, ...args: unknown[]) =>
        tbCalls.push({ tenantKey, method, args });
      return {
        rpcOneway: async (deviceId: string, method: string, params: unknown) => {
          rpcCalls.push({ tenantKey, deviceId, method, params });
        },
        getLatestTimeseries: async () => ({}),
        getTimeseries: async (deviceId: string, params: unknown) => {
          record('getTimeseries', deviceId, params);
          return timeseries;
        },
        saveDevice: async (device: { name: string }, accessToken?: string) => {
          record('saveDevice', device, accessToken);
          if (device.name.endsWith('-FAIL')) throw new Error('ThingsBoard refused the device');
          deviceSeq++;
          return {
            ...device,
            id: {
              id: `00000000-0000-4000-8000-${String(deviceSeq).padStart(12, '0')}`,
              entityType: 'DEVICE',
            },
          };
        },
        saveServerAttributes: async (...args: unknown[]) => record('saveServerAttributes', ...args),
        saveRelation: async (...args: unknown[]) => record('saveRelation', ...args),
        deleteDevice: async (id: string) => record('deleteDevice', id),
      };
    },
    reachable: async () => true,
  } as unknown as TbClientRegistry;

  const container = buildContainer(config, {
    db,
    redis,
    tb: fakeTb,
    dispatcher: opts.simulatorDispatcher,
  });

  const [alpha, beta] = await withoutTenant(db.admin, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([
        {
          key: 'alpha',
          name: 'Alpha',
          hostname: 'alpha.localhost',
          brand: defaultBrand('Alpha'),
          demoMode: true,
          tbTenantId: 'tb-alpha',
        },
        {
          key: 'beta',
          name: 'Beta',
          hostname: 'beta.localhost',
          brand: { ...defaultBrand('Beta'), primaryColor: '#B5451B' },
          demoMode: false,
          tbTenantId: 'tb-beta',
        },
      ])
      .returning();
    return rows as [TenantRow, TenantRow];
  });

  for (const tenant of [alpha, beta]) {
    await runWithContext({ requestId: 'system', tenantId: tenant.id, tenantKey: tenant.key }, () =>
      withTenant(db.app, tenant.id, async (tx) => {
        const [floor] = await tx
          .insert(locations)
          .values({ tenantId: tenant.id, type: 'FLOOR', code: 'F1', name: 'Floor 1', floor: 1 })
          .returning();
        await tx.insert(locations).values({
          tenantId: tenant.id,
          type: 'ROOM',
          code: '1.1',
          name: `Room 1.1 of ${tenant.key}`,
          parentId: floor!.id,
          floor: 1,
          zone: '1.West',
          kind: 'meeting',
          geometry: { x: 40, y: 40, w: 160, h: 180 },
        });
        for (const [local, role] of [
          ['admin', 'TENANT_ADMIN'],
          ['ops', 'OPS_MANAGER'],
          ['field', 'FIELD_OPERATOR'],
          ['finance', 'FINANCE'],
          ['viewer', 'VIEWER'],
        ] as const) {
          await container.users.upsertInTx(tx, tenant.id, {
            email: `${local}@${tenant.key}.demo`,
            password: 'Demo1234!',
            role,
            displayName: local,
          });
        }
      }),
    );
  }

  const fastify = Fastify({ logger: false });
  await fastify.register(app, { config, container, skipLiveRebuild: true });
  await fastify.ready();

  return {
    fastify,
    container,
    config,
    db,
    alpha,
    beta,
    rpcCalls,
    tbCalls,
    timeseries,
    async close() {
      await fastify.close();
      redis.disconnect();
      await container.close();
      await db.close();
    },
  };
}

export async function login(
  t: TestApp,
  host: string,
  email: string,
  password = 'Demo1234!',
): Promise<string> {
  const res = await t.fastify.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { host },
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { accessToken: string }).accessToken;
}
