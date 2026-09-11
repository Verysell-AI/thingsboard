import { z } from 'zod';

/** Platform roles, from most to least privileged. */
export const ROLES = [
  'TENANT_ADMIN',
  'OPS_MANAGER',
  'FIELD_OPERATOR',
  'FINANCE',
  'VIEWER',
] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** Roles allowed to issue device commands and run automations. */
export const COMMAND_ROLES: readonly Role[] = ['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR'];

export function canCommand(role: Role): boolean {
  return COMMAND_ROLES.includes(role);
}
