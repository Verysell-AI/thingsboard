import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  AdminDatasetsResponseSchema,
  AdminJobSchema,
  AdminPlatformResponseSchema,
  AdminTenantSchema,
  AdminTenantsResponseSchema,
  AdminUsersResponseSchema,
  PlatformAdminSchema,
  TokenPairSchema,
  type AdminJob,
  type AdminPlatformResponse,
  type AdminTenant,
  type AdminUser,
  type BrandAsset,
  type CreateAdminUserRequest,
  type CreateTenantRequest,
  type PlatformAdmin,
  type UpdateAdminUserRequest,
  type UpdateTenantRequest,
} from '@platform/shared/dto';
import { adminApi } from './api';
import { adminSession } from './auth';

export const adminKeys = {
  me: ['admin', 'me'] as const,
  tenants: ['admin', 'tenants'] as const,
  tenant: (key: string) => ['admin', 'tenants', key] as const,
  users: (key: string) => ['admin', 'tenants', key, 'users'] as const,
  datasets: ['admin', 'datasets'] as const,
  platform: ['admin', 'platform'] as const,
  job: (id: string) => ['admin', 'jobs', id] as const,
};

export async function adminLogin(email: string, password: string): Promise<void> {
  const tokens = await adminApi.post('/admin/auth/login', { email, password }, TokenPairSchema, {
    auth: false,
  });
  adminSession.setTokens(tokens);
}

export function useAdminMe(): UseQueryResult<PlatformAdmin> {
  return useQuery({
    queryKey: adminKeys.me,
    queryFn: () => adminApi.get('/admin/auth/me', PlatformAdminSchema),
    enabled: adminSession.isAuthenticated(),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useAdminTenants(): UseQueryResult<AdminTenant[]> {
  return useQuery({
    queryKey: adminKeys.tenants,
    queryFn: async () => (await adminApi.get('/admin/tenants', AdminTenantsResponseSchema)).items,
    retry: false,
  });
}

export function useAdminTenant(key: string): UseQueryResult<AdminTenant> {
  return useQuery({
    queryKey: adminKeys.tenant(key),
    queryFn: () => adminApi.get(`/admin/tenants/${key}`, AdminTenantSchema),
    retry: false,
  });
}

export function useAdminUsers(key: string): UseQueryResult<AdminUser[]> {
  return useQuery({
    queryKey: adminKeys.users(key),
    queryFn: async () =>
      (await adminApi.get(`/admin/tenants/${key}/users`, AdminUsersResponseSchema)).items,
    retry: false,
  });
}

export function useDatasets(): UseQueryResult<string[]> {
  return useQuery({
    queryKey: adminKeys.datasets,
    queryFn: async () => (await adminApi.get('/admin/datasets', AdminDatasetsResponseSchema)).items,
    staleTime: Infinity,
    retry: false,
  });
}

export function usePlatformInfo(): UseQueryResult<AdminPlatformResponse> {
  return useQuery({
    queryKey: adminKeys.platform,
    queryFn: () => adminApi.get('/admin/platform', AdminPlatformResponseSchema),
    staleTime: Infinity,
    retry: false,
  });
}

/** Polls a provisioning job until it finishes. */
export function useAdminJob(id: string | null): UseQueryResult<AdminJob> {
  return useQuery({
    queryKey: adminKeys.job(id ?? ''),
    queryFn: () => adminApi.get(`/admin/jobs/${id}`, AdminJobSchema),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
    retry: false,
  });
}

export const createTenant = (body: CreateTenantRequest): Promise<AdminJob> =>
  adminApi.post('/admin/tenants', body, AdminJobSchema);

export const updateTenant = (key: string, body: UpdateTenantRequest): Promise<AdminTenant> =>
  adminApi.patch(`/admin/tenants/${key}`, body, AdminTenantSchema);

export const deleteTenant = (key: string): Promise<AdminJob> =>
  adminApi.delete(`/admin/tenants/${key}`, AdminJobSchema);

export const loadTenantDataset = (key: string, dataset: string): Promise<AdminJob> =>
  adminApi.post(`/admin/tenants/${key}/dataset`, { dataset }, AdminJobSchema);

export const createTenantUser = (key: string, body: CreateAdminUserRequest): Promise<AdminUser> =>
  adminApi.post(`/admin/tenants/${key}/users`, body);

export const updateTenantUser = (
  key: string,
  id: string,
  body: UpdateAdminUserRequest,
): Promise<AdminUser> => adminApi.patch(`/admin/tenants/${key}/users/${id}`, body);

export const deleteTenantUser = (key: string, id: string): Promise<void> =>
  adminApi.delete(`/admin/tenants/${key}/users/${id}`);

/** Largest upload we accept; the API stores the payload inside the tenant's brand JSON. */
export const MAX_BRAND_BYTES = 1_000_000;
export const BRAND_ACCEPT = 'image/svg+xml,image/png,image/jpeg,image/webp';

/** Reads a picked file into the shape the API stores: SVG markup, or base64 for raster images. */
export async function readBrandFile(file: File): Promise<BrandAsset> {
  if (file.size > MAX_BRAND_BYTES) throw new Error('too-large');
  const mime = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (mime === 'image/svg+xml') return { mime, content: await file.text() };
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp')
    throw new Error('unsupported');
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return { mime, content: btoa(binary) };
}

/** Data URL for previewing an asset the operator just picked. */
export function brandAssetPreview(asset: BrandAsset): string {
  return asset.mime === 'image/svg+xml'
    ? `data:image/svg+xml;utf8,${encodeURIComponent(asset.content)}`
    : `data:${asset.mime};base64,${asset.content}`;
}
