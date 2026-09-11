import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { assets, locations, tenants } from './schema/index.js';
import { withoutTenant } from './tenant.js';
import type { DeviceLookup, DeviceResolver } from '../services/tb/tb-events.service.js';

/**
 * Maps a ThingsBoard device id to its tenant and asset. Events arrive before any tenant is known,
 * so this is the one read that legitimately bypasses row-level security; results are cached.
 */
export class DbDeviceResolver implements DeviceResolver {
  private readonly cache = new Map<string, { value: DeviceLookup | null; expires: number }>();

  constructor(
    private readonly admin: Db,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  async byTbDeviceId(tbDeviceId: string): Promise<DeviceLookup | null> {
    const hit = this.cache.get(tbDeviceId);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = await withoutTenant(this.admin, async (tx) => {
      const rows = await tx
        .select({
          tenantId: assets.tenantId,
          tenantKey: tenants.key,
          assetId: assets.id,
          deviceCode: assets.code,
          deviceType: assets.deviceType,
          room: locations.code,
        })
        .from(assets)
        .innerJoin(tenants, eq(tenants.id, assets.tenantId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(eq(assets.tbDeviceId, tbDeviceId))
        .limit(1);
      return rows[0] ?? null;
    });
    // Negative results expire fast so a freshly created device is picked up quickly.
    this.cache.set(tbDeviceId, { value, expires: this.now() + (value ? this.ttlMs : 2_000) });
    return value;
  }
}

/** All devices with a ThingsBoard id, grouped by tenant key: used to rebuild live state on startup. */
export type TenantDevice = DeviceLookup & { tbDeviceId: string };

export async function listDevicesByTenant(admin: Db): Promise<Map<string, TenantDevice[]>> {
  return withoutTenant(admin, async (tx) => {
    const rows = await tx
      .select({
        tenantId: assets.tenantId,
        tenantKey: tenants.key,
        assetId: assets.id,
        deviceCode: assets.code,
        deviceType: assets.deviceType,
        room: locations.code,
        tbDeviceId: assets.tbDeviceId,
      })
      .from(assets)
      .innerJoin(tenants, eq(tenants.id, assets.tenantId))
      .leftJoin(locations, eq(locations.id, assets.locationId));
    const out = new Map<string, TenantDevice[]>();
    for (const r of rows) {
      if (!r.tbDeviceId) continue;
      const list = out.get(r.tenantKey) ?? [];
      list.push({ ...r, tbDeviceId: r.tbDeviceId });
      out.set(r.tenantKey, list);
    }
    return out;
  });
}
