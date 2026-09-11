import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_TIME_ZONE } from '@platform/shared/clock';

const apiRoot = resolve(dirname(import.meta.dirname));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  TB_URL: z.string().url().default('http://localhost:8090'),
  TB_PUBLIC_URL: z.string().url().default('http://localhost:8090'),
  TB_SYSADMIN_EMAIL: z.string().email().default('sysadmin@thingsboard.org'),
  TB_SYSADMIN_PASSWORD: z.string().default('sysadmin'),
  TB_SERVICE_PASSWORD: z.string().min(6).default('change-me-service'),
  TENANT_DOMAIN: z.string().default('demo'),
  /** Bare hostname of this deployment (the platform console); new tenants default to `<key>.<PLATFORM_HOST>`. */
  PLATFORM_HOST: z.string().min(1).default('localhost'),
  /** Zone for wall-clock rules and the header clock; docker-compose sets TZ for every service. */
  TZ: z.string().optional(),
  TIME_ZONE: z.string().default(''),

  DATABASE_URL: z.string().default('postgres://app:app-dev-password@localhost:5434/platform'),
  DATABASE_ADMIN_URL: z
    .string()
    .default('postgres://app_admin:app-admin-dev-password@localhost:5434/platform'),
  REDIS_URL: z.string().default('redis://localhost:6380'),

  API_PORT: z.coerce.number().int().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  JWT_SECRET: z.string().min(16).default('dev-only-jwt-secret-change-me-please'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  INTERNAL_API_TOKEN: z.string().min(8).default('dev-internal-token'),

  /** First platform operator, created on boot; an empty password disables the console login. */
  PLATFORM_ADMIN_EMAIL: z.string().email().default('admin@platform.local'),
  PLATFORM_ADMIN_PASSWORD: z.string().default(''),

  SIMULATOR_URL: z.string().url().default('http://localhost:4100'),
  DATASET_USER_PASSWORD: z.string().min(6).default('Demo1234!'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('no-reply@platform.local'),

  /** Cumulative hours a laptop may sit in a foreign room before it is flagged misplaced. */
  MISPLACED_HOURS: z.coerce.number().positive().default(8),
  /** Base interval of the automation tick, in real seconds. */
  AUTOMATION_TICK_SECONDS: z.coerce.number().int().min(5).default(60),

  DATASETS_DIR: z.string().default(resolve(apiRoot, '..', 'datasets')),
  TB_ARTEFACTS_DIR: z.string().default(resolve(apiRoot, '..', 'thingsboard')),
});

export type Config = z.infer<typeof envSchema>;

const SECRET_KEYS: (keyof Config)[] = [
  'TB_SYSADMIN_PASSWORD',
  'TB_SERVICE_PASSWORD',
  'DATABASE_URL',
  'DATABASE_ADMIN_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'INTERNAL_API_TOKEN',
  'DATASET_USER_PASSWORD',
  'PLATFORM_ADMIN_PASSWORD',
  'SMTP_URL',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const config = parsed.data;
  config.TIME_ZONE = config.TIME_ZONE || config.TZ || DEFAULT_TIME_ZONE;
  return config;
}

/** Copy of the config safe to log. */
export function redactConfig(config: Config): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of SECRET_KEYS) out[key] = '***';
  return out;
}

/** Test configuration with in-memory-friendly defaults. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), NODE_ENV: 'test', ...overrides };
}
