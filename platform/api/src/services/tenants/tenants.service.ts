import { eq } from 'drizzle-orm';
import type { Branding } from '@platform/shared/dto';
import { DEFAULT_BRAND } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import {
  tenants,
  type TenantBrand,
  type TenantBrandAsset,
  type TenantRow,
} from '../../db/schema/index.js';

export const SVG_MIME = 'image/svg+xml';

export const DEFAULT_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48" width="240" height="48" role="img" aria-label="Facilities Platform"><rect x="6" y="8" width="32" height="32" rx="8" fill="#2563EB"/><path d="M14 30 L22 18 L30 30 Z" fill="#fff"/><text x="50" y="31" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="700" fill="#1F2937">Facilities Platform</text></svg>';
export const DEFAULT_FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect width="48" height="48" rx="10" fill="#2563EB"/><path d="M14 32 L24 16 L34 32 Z" fill="#fff"/></svg>';

export function svgAsset(markup: string): TenantBrandAsset {
  return { mime: SVG_MIME, content: markup };
}

/** Body and content type to send for a brand asset; raster content is stored base64. */
export function brandAssetBody(asset: TenantBrandAsset): { mime: string; body: string | Buffer } {
  return asset.mime === SVG_MIME
    ? { mime: asset.mime, body: asset.content }
    : { mime: asset.mime, body: Buffer.from(asset.content, 'base64') };
}

export function defaultBrand(name: string = DEFAULT_BRAND.name): TenantBrand {
  return {
    name,
    shortName: DEFAULT_BRAND.shortName,
    primaryColor: DEFAULT_BRAND.primaryColor,
    accentColor: DEFAULT_BRAND.accentColor,
    logo: svgAsset(DEFAULT_LOGO_SVG),
    favicon: svgAsset(DEFAULT_FAVICON_SVG),
    fontFamily: DEFAULT_BRAND.fontFamily,
    loginTagline: null,
    dashboards: {},
  };
}

export function toBranding(tenant: TenantRow): Branding {
  const b = tenant.brand;
  return {
    tenantKey: tenant.key,
    name: b.name,
    shortName: b.shortName,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    logoUrl: '/branding/logo',
    faviconUrl: '/branding/favicon',
    faviconMime: b.favicon.mime,
    fontFamily: b.fontFamily,
    loginTagline: b.loginTagline ?? null,
    locale: tenant.locale === 'ar' ? 'ar' : 'en',
    title: b.name,
    demoMode: tenant.demoMode,
  };
}

/** Tenant lookups run on the app role: the tenants table has no RLS so hostname resolution works pre-context. */
export class TenantsService {
  constructor(private readonly db: Db) {}

  async byHostname(hostname: string): Promise<TenantRow | null> {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.hostname, hostname))
      .limit(1);
    return rows[0] ?? null;
  }

  async byKey(key: string): Promise<TenantRow | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.key, key)).limit(1);
    return rows[0] ?? null;
  }

  async byId(id: string): Promise<TenantRow | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** Tenants whose devices the simulator drives. */
  async simulated(): Promise<TenantRow[]> {
    return this.db.select().from(tenants).where(eq(tenants.simulated, true));
  }

  async all(): Promise<TenantRow[]> {
    return this.db.select().from(tenants);
  }
}
