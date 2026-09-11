import { z } from 'zod';
import { DepartmentSchema, PersonaKeySchema } from '../dataset/schema.js';
import { AssetSchema } from './assets.js';
import { IdSchema } from './common.js';

export const EmployeeSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  department: z.string(),
  deskRoom: z.object({ id: IdSchema, code: z.string(), name: z.string() }).nullable(),
  deskCode: z.string().nullable(),
  zone: z.string().nullable(),
  persona: z.string().nullable(),
  email: z.string(),
  laptop: z.object({ assetId: IdSchema, code: z.string() }).nullable(),
  createdAt: z.string(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const EmployeesResponseSchema = z.object({ items: z.array(EmployeeSchema) });
export type EmployeesResponse = z.infer<typeof EmployeesResponseSchema>;

/** Body of POST /employees: HR adds a person; the platform creates the laptop asset and device. */
export const CreateEmployeeSchema = z.object({
  name: z.string().min(2).max(120),
  department: DepartmentSchema,
  deskRoomId: IdSchema,
  /** Desk inside the open-plan room; a free desk is picked when omitted. */
  deskCode: z.string().optional(),
  /** Only honoured for tenants in demo mode (drives the simulated laptop). */
  persona: PersonaKeySchema.optional(),
  /** Defaults to firstname.lastname@<tenant>.<domain>. */
  email: z.string().email().optional(),
});
export type CreateEmployee = z.infer<typeof CreateEmployeeSchema>;

export const CreateEmployeeResponseSchema = z.object({
  employee: EmployeeSchema,
  asset: AssetSchema,
  /** True when a virtual laptop was registered with the simulator (demo mode). */
  simulated: z.boolean(),
});
export type CreateEmployeeResponse = z.infer<typeof CreateEmployeeResponseSchema>;
