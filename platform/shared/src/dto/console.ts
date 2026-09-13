import { z } from 'zod';
import { ClockStateSchema } from '../clock.js';

/** Scenario names the simulator understands (context §8). */
export const SCENARIO_NAMES = [
  'new-laptop-first-boot',
  'everyone-leaves',
  'late-worker-stays',
  'lunch-peak',
  'heater-left-on',
  'ac-filter-degrade',
  'ghost-meeting',
  'move-laptop',
  'laptop-toggle',
] as const;
export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);
export type ScenarioName = z.infer<typeof ScenarioNameSchema>;

export const ScenarioParamsSchema = z.object({
  /** Device code (laptop or AC unit) */
  code: z.string().optional(),
  employeeId: z.string().optional(),
  room: z.string().optional(),
});
export type ScenarioParams = z.infer<typeof ScenarioParamsSchema>;

export const ScenarioResultSchema = z.object({
  scenario: ScenarioNameSchema,
  accepted: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

/** Body for POST simulator/devices (add a virtual device at runtime). */
export const SimulatorAddDeviceSchema = z.object({
  tenant: z.string(),
  code: z.string(),
  type: z.string(),
  accessToken: z.string(),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type SimulatorAddDevice = z.infer<typeof SimulatorAddDeviceSchema>;

/** Tenants the simulator should drive, served by GET /internal/tenants/simulated. */
export const SimulatedTenantsResponseSchema = z.object({
  items: z.array(z.object({ key: z.string() })),
});
export type SimulatedTenantsResponse = z.infer<typeof SimulatedTenantsResponseSchema>;

/** Answer to PUT simulator/tenants/:key (tenant world loaded or reloaded). */
export const SimulatorTenantSchema = z.object({
  key: z.string(),
  devices: z.number().int().min(0),
});
export type SimulatorTenant = z.infer<typeof SimulatorTenantSchema>;

/** Snapshot returned by GET simulator/state. */
export const SimulatorDeviceStateSchema = z.object({
  tenant: z.string(),
  code: z.string(),
  type: z.string(),
  connected: z.boolean(),
  room: z.string().nullable(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export const SimulatorStateSchema = z.object({
  /** Business clock per tenant (context §8.1). */
  clocks: z.record(z.string(), ClockStateSchema),
  timeZone: z.string(),
  tickMs: z.number(),
  devices: z.array(SimulatorDeviceStateSchema),
});
export type SimulatorState = z.infer<typeof SimulatorStateSchema>;

/** Body for PUT simulator/clock: the API pushes a tenant's business clock to the simulator. */
export const SimulatorSetClockSchema = z.object({
  tenant: z.string(),
  state: ClockStateSchema,
});
export type SimulatorSetClock = z.infer<typeof SimulatorSetClockSchema>;
