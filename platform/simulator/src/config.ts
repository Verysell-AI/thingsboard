import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_TIME_ZONE } from '@platform/shared/clock';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EnvSchema = z.object({
  SIM_TENANTS: z.string().default('alpha,beta'),
  SIM_DATASET: z.string().default('office-demo'),
  DATASETS_DIR: z.string().default(resolve(packageRoot, '../datasets')),
  SIM_MQTT_URL: z.string().default('mqtt://localhost:1884'),
  SIM_TICK_MS: z.coerce.number().int().min(500).default(10_000),
  /** Zone for persona schedules; TZ is what docker-compose sets for every service. */
  TZ: z.string().optional(),
  SIM_TIME_ZONE: z.string().optional(),
  SIMULATOR_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  INTERNAL_API_TOKEN: z.string().min(1, 'INTERNAL_API_TOKEN is required'),
  API_URL: z.string().default('http://localhost:4000'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
});

export interface SimulatorConfig {
  tenants: string[];
  dataset: string;
  datasetsDir: string;
  mqttUrl: string;
  tickMs: number;
  timeZone: string;
  port: number;
  internalToken: string;
  apiUrl: string;
  logLevel: string;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid simulator configuration: ${parsed.error.message}`);
  }
  const e = parsed.data;
  const tenants = e.SIM_TENANTS.split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tenants.length === 0) throw new Error('SIM_TENANTS must list at least one tenant');
  return {
    tenants,
    dataset: e.SIM_DATASET,
    datasetsDir: e.DATASETS_DIR,
    mqttUrl: e.SIM_MQTT_URL,
    tickMs: e.SIM_TICK_MS,
    timeZone: e.SIM_TIME_ZONE ?? e.TZ ?? DEFAULT_TIME_ZONE,
    port: e.SIMULATOR_PORT,
    internalToken: e.INTERNAL_API_TOKEN,
    apiUrl: e.API_URL,
    logLevel: e.LOG_LEVEL,
    production: e.NODE_ENV === 'production',
  };
}
