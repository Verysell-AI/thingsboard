import type { TenantRow } from '../../db/schema/index.js';
import type { TenantsService } from './tenants.service.js';

export interface ResolveInput {
  host?: string | string[];
  tenantKeyHeader?: string | string[];
}

/** Strips the port and lower-cases the Host header. */
export function hostnameOf(host: string | string[] | undefined): string | null {
  const raw = Array.isArray(host) ? host[0] : host;
  if (!raw) return null;
  const withoutPort = raw.replace(/:\d+$/, '');
  return withoutPort.trim().toLowerCase() || null;
}

/**
 * Resolves the tenant for a request: Host header first; `X-Tenant-Key` only when that tenant runs
 * in demo mode (phones cannot resolve *.localhost). Results are cached briefly.
 */
export class TenantResolver {
  private readonly cache = new Map<string, { row: TenantRow | null; expires: number }>();

  constructor(
    private readonly tenants: TenantsService,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  private async cached(
    key: string,
    load: () => Promise<TenantRow | null>,
  ): Promise<TenantRow | null> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) return hit.row;
    const row = await load();
    this.cache.set(key, { row, expires: this.now() + this.ttlMs });
    return row;
  }

  async resolve(input: ResolveInput): Promise<TenantRow | null> {
    const hostname = hostnameOf(input.host);
    if (hostname) {
      const byHost = await this.cached(`host:${hostname}`, () => this.tenants.byHostname(hostname));
      if (byHost) return byHost;
    }
    const keyRaw = Array.isArray(input.tenantKeyHeader)
      ? input.tenantKeyHeader[0]
      : input.tenantKeyHeader;
    if (keyRaw) {
      const byKey = await this.cached(`key:${keyRaw}`, () => this.tenants.byKey(keyRaw));
      if (byKey?.demoMode) return byKey;
    }
    return null;
  }
}
