import { z } from 'zod';
import { LocaleSchema } from '../dataset/schema.js';
import { RoleSchema } from '../roles.js';
import { IdSchema } from './common.js';

/** Image types a brand asset may use; SVG is stored as markup, the rest as base64. */
export const BRAND_ASSET_MIMES = [
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export const BrandAssetMimeSchema = z.enum(BRAND_ASSET_MIMES);
export type BrandAssetMime = z.infer<typeof BrandAssetMimeSchema>;

/** A logo or favicon: SVG markup for `image/svg+xml`, base64 payload for raster types. */
export const BrandAssetSchema = z.object({
  mime: BrandAssetMimeSchema,
  content: z.string().min(1).max(2_000_000),
});
export type BrandAsset = z.infer<typeof BrandAssetSchema>;

export const TENANT_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const TenantKeySchema = z
  .string()
  .regex(TENANT_KEY_RE, 'lower-case letters, digits and dashes; must start with a letter');

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ColorSchema = z.string().regex(HEX_COLOR, 'six-digit hex colour, e.g. #2563EB');

/** Brand fields an operator may edit; omitted fields keep their current value. */
export const BrandInputSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  shortName: z.string().min(1).max(40).optional(),
  primaryColor: ColorSchema.optional(),
  accentColor: ColorSchema.optional(),
  fontFamily: z.string().min(2).max(200).optional(),
  loginTagline: z.string().max(200).nullish(),
  logo: BrandAssetSchema.nullish(),
  favicon: BrandAssetSchema.nullish(),
});
export type BrandInput = z.infer<typeof BrandInputSchema>;

export const AdminTenantSchema = z.object({
  id: IdSchema,
  key: z.string(),
  name: z.string(),
  hostname: z.string(),
  locale: LocaleSchema,
  currency: z.string(),
  tariffPerKwh: z.number(),
  demoMode: z.boolean(),
  tbTenantId: z.string().nullable(),
  primaryColor: z.string(),
  accentColor: z.string(),
  shortName: z.string(),
  fontFamily: z.string(),
  loginTagline: z.string().nullable(),
  logoUrl: z.string(),
  faviconUrl: z.string(),
  userCount: z.number().int().min(0),
  createdAt: z.string(),
  /** Convenient absolute URL of the tenant's web app, built from the request origin. */
  url: z.string(),
});
export type AdminTenant = z.infer<typeof AdminTenantSchema>;

export const AdminTenantsResponseSchema = z.object({ items: z.array(AdminTenantSchema) });
export type AdminTenantsResponse = z.infer<typeof AdminTenantsResponseSchema>;

/** Settings an operator may set; create gives them defaults, update leaves them untouched. */
const tenantSettings = {
  name: z.string().min(2).max(80),
  hostname: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9.-]+$/, 'lower-case host name, e.g. gamma.localhost'),
  locale: LocaleSchema,
  currency: z.string().min(3).max(3),
  tariffPerKwh: z.number().positive().max(100),
  demoMode: z.boolean(),
};

export const CreateTenantRequestSchema = z.object({
  ...tenantSettings,
  hostname: tenantSettings.hostname.optional(),
  locale: tenantSettings.locale.default('en'),
  currency: tenantSettings.currency.default('AED'),
  tariffPerKwh: tenantSettings.tariffPerKwh.default(0.44),
  demoMode: tenantSettings.demoMode.default(false),
  key: TenantKeySchema,
  brand: BrandInputSchema.optional(),
  /** Dataset folder to load after provisioning (e.g. office-demo); null loads nothing. */
  dataset: z.string().max(60).nullish(),
  /** First tenant user; omitted for a tenant whose dataset already brings users. */
  admin: z
    .object({
      email: z.string().email(),
      password: z.string().min(8).max(200),
      displayName: z.string().min(2).max(80).optional(),
    })
    .optional(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

/** Every field is optional and carries no default: an omitted field keeps its current value. */
export const UpdateTenantRequestSchema = z
  .object(tenantSettings)
  .partial()
  .extend({ brand: BrandInputSchema.optional() });
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;

export const AdminUserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  role: RoleSchema,
  displayName: z.string(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUsersResponseSchema = z.object({ items: z.array(AdminUserSchema) });
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

export const CreateAdminUserRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: RoleSchema,
  displayName: z.string().min(2).max(80).optional(),
});
export type CreateAdminUserRequest = z.infer<typeof CreateAdminUserRequestSchema>;

export const UpdateAdminUserRequestSchema = z.object({
  role: RoleSchema.optional(),
  displayName: z.string().min(2).max(80).optional(),
  password: z.string().min(8).max(200).optional(),
});
export type UpdateAdminUserRequest = z.infer<typeof UpdateAdminUserRequestSchema>;

export const ADMIN_JOB_STATUSES = ['running', 'succeeded', 'failed'] as const;
export const AdminJobStatusSchema = z.enum(ADMIN_JOB_STATUSES);
export type AdminJobStatus = z.infer<typeof AdminJobStatusSchema>;

/** Progress record of a long provisioning task, polled by the console. */
export const AdminJobSchema = z.object({
  id: z.string(),
  kind: z.enum(['tenant.create', 'tenant.dataset', 'tenant.delete']),
  tenantKey: z.string(),
  status: AdminJobStatusSchema,
  log: z.array(z.string()),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type AdminJob = z.infer<typeof AdminJobSchema>;

export const PlatformAdminSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
});
export type PlatformAdmin = z.infer<typeof PlatformAdminSchema>;

/** Claims of a platform-admin access token; `scope` keeps it apart from tenant tokens. */
export const PlatformAccessClaimsSchema = z.object({
  sub: IdSchema,
  email: z.string().email(),
  scope: z.literal('platform'),
  type: z.literal('access'),
});
export type PlatformAccessClaims = z.infer<typeof PlatformAccessClaimsSchema>;

export const PlatformRefreshClaimsSchema = z.object({
  sub: IdSchema,
  scope: z.literal('platform'),
  type: z.literal('refresh'),
});
export type PlatformRefreshClaims = z.infer<typeof PlatformRefreshClaimsSchema>;

/** Datasets the console offers when creating a tenant. */
/** Deployment-wide values the console needs before creating a tenant. */
export const AdminPlatformResponseSchema = z.object({
  /** Bare host of this deployment; new tenants default to `<key>.<host>`. */
  host: z.string(),
  apiPublicUrl: z.string(),
});
export type AdminPlatformResponse = z.infer<typeof AdminPlatformResponseSchema>;

export const AdminDatasetsResponseSchema = z.object({ items: z.array(z.string()) });
export type AdminDatasetsResponse = z.infer<typeof AdminDatasetsResponseSchema>;
