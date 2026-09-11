import { z } from 'zod';
import { RoleSchema } from '../roles.js';
import { LocaleSchema } from '../dataset/schema.js';
import { IdSchema } from './common.js';

export const TenantSummarySchema = z.object({
  id: IdSchema,
  key: z.string(),
  name: z.string(),
  hostname: z.string(),
  locale: LocaleSchema,
  currency: z.string(),
  tariffPerKwh: z.number(),
  demoMode: z.boolean(),
  /** IANA zone the tenant's wall-clock rules and the header clock use. */
  timeZone: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummarySchema>;

export const UserSummarySchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  role: RoleSchema,
  employeeId: IdSchema.nullable(),
  displayName: z.string(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const MeResponseSchema = z.object({
  user: UserSummarySchema,
  tenant: TenantSummarySchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
