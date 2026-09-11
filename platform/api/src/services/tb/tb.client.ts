import { fetch, type Dispatcher } from 'undici';
import type { RpcMethod } from '@platform/shared/contracts';
import { upstream } from '../../lib/errors.js';

/**
 * The only module that talks to ThingsBoard over HTTP (context §6.2). One client per login
 * identity (sysadmin or a tenant service account); tokens refresh transparently on 401.
 */

export interface TbId {
  id: string;
  entityType: string;
}

export interface TbEntity {
  id?: TbId;
  name: string;
  [key: string]: unknown;
}

export interface TbDevice extends TbEntity {
  type?: string;
  label?: string;
  deviceProfileId?: TbId;
}

export interface TbAsset extends TbEntity {
  type?: string;
  label?: string;
  assetProfileId?: TbId;
}

export interface TbUser {
  id?: TbId;
  email: string;
  authority: 'SYS_ADMIN' | 'TENANT_ADMIN' | 'CUSTOMER_USER';
  firstName?: string;
  lastName?: string;
  tenantId?: TbId;
  customerId?: TbId;
}

export interface TbPage<T> {
  data: T[];
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
}

export interface TbRuleChain extends TbEntity {
  root?: boolean;
  type?: string;
}

export interface TbRuleChainMetadata {
  ruleChainId?: TbId;
  firstNodeIndex: number;
  nodes: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  ruleChainConnections?: Record<string, unknown>[] | null;
}

export interface TbAlarm {
  id: TbId;
  type: string;
  severity: string;
  status: string;
  originator: TbId;
  startTs: number;
  endTs: number;
  acknowledged?: boolean;
  cleared?: boolean;
}

export type TbTsValue = { ts: number; value: string };
export type TbTimeseries = Record<string, TbTsValue[]>;

export interface TbClientOptions {
  baseUrl: string;
  email: string;
  password: string;
  dispatcher?: Dispatcher;
  timeoutMs?: number;
}

export class TbError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`ThingsBoard ${status} on ${path}`);
    this.name = 'TbError';
  }
}

export function isTbError(err: unknown): err is TbError {
  return (
    err instanceof TbError ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TbError')
  );
}

export class TbClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor(private readonly opts: TbClientOptions) {}

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  /** Current token pair (used to hand the dashboards user's tokens to the iframe). */
  async tokens(): Promise<{ token: string; refreshToken: string }> {
    await this.ensureLogin();
    return { token: this.token!, refreshToken: this.refreshToken! };
  }

  /** Changes the password of the currently logged-in user. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('POST', '/api/auth/changePassword', { currentPassword, newPassword });
  }

  /** Reachability probe without credentials: any HTTP answer counts as reachable. */
  static async reachable(
    baseUrl: string,
    dispatcher?: Dispatcher,
    timeoutMs = 3000,
  ): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'GET',
        redirect: 'manual',
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.arrayBuffer().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  // ---- auth ---------------------------------------------------------------------------------

  private async ensureLogin(): Promise<void> {
    if (this.token) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.opts.email, password: this.opts.password }),
      dispatcher: this.opts.dispatcher,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new TbError(res.status, '/api/auth/login', await res.text());
    const body = (await res.json()) as { token: string; refreshToken: string };
    this.token = body.token;
    this.refreshToken = body.refreshToken;
  }

  private async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    const res = await fetch(`${this.opts.baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
      dispatcher: this.opts.dispatcher,
    });
    if (!res.ok) {
      await res.text();
      return false;
    }
    const body = (await res.json()) as { token: string; refreshToken: string };
    this.token = body.token;
    this.refreshToken = body.refreshToken;
    return true;
  }

  /** Generic authenticated request; retries once after refreshing (or re-logging in) on 401. */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retry = true,
    timeoutMs = this.opts.timeoutMs ?? 15_000,
  ): Promise<T> {
    await this.ensureLogin();
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'X-Authorization': `Bearer ${this.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: this.opts.dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 && retry) {
      await res.text();
      const refreshed = await this.refresh();
      if (!refreshed) {
        this.token = null;
        await this.ensureLogin();
      }
      return this.request<T>(method, path, body, false, timeoutMs);
    }
    const text = await res.text();
    if (!res.ok) throw new TbError(res.status, path, text);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  // ---- sysadmin -----------------------------------------------------------------------------

  async createTenant(title: string): Promise<TbEntity & { title: string }> {
    return this.request('POST', '/api/tenant', { title, region: 'Global' });
  }

  async findTenantByTitle(title: string): Promise<(TbEntity & { title: string }) | null> {
    const page = await this.request<TbPage<TbEntity & { title: string }>>(
      'GET',
      `/api/tenants?pageSize=100&page=0&textSearch=${encodeURIComponent(title)}`,
    );
    return page.data.find((t) => t.title === title) ?? null;
  }

  async getTenantById(id: string): Promise<(TbEntity & { title: string }) | null> {
    try {
      return await this.request('GET', `/api/tenant/${id}`);
    } catch (err) {
      if (err instanceof TbError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
  }

  /** Renames a tenant; ThingsBoard saves the whole entity, so the current one is fetched first. */
  async renameTenant(id: string, title: string): Promise<void> {
    const current = await this.getTenantById(id);
    if (!current || current.title === title) return;
    await this.request('POST', '/api/tenant', { ...current, title });
  }

  async deleteTenant(id: string): Promise<void> {
    try {
      await this.request<void>('DELETE', `/api/tenant/${id}`);
    } catch (err) {
      if (err instanceof TbError && err.status === 404) return;
      throw err;
    }
  }

  async findTenantAdminByEmail(tenantId: string, email: string): Promise<TbUser | null> {
    const page = await this.request<TbPage<TbUser>>(
      'GET',
      `/api/tenant/${tenantId}/users?pageSize=100&page=0&textSearch=${encodeURIComponent(email)}`,
    );
    return page.data.find((u) => u.email === email) ?? null;
  }

  async createUser(user: TbUser): Promise<TbUser> {
    return this.request('POST', '/api/user?sendActivationMail=false', user);
  }

  async getActivationLink(userId: string): Promise<string> {
    return this.request<string>('GET', `/api/user/${userId}/activationLink`);
  }

  /** Activation does not need a session; the token comes from the activation link. */
  async activateUser(activateToken: string, password: string): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/api/noauth/activate?sendActivationMail=false`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activateToken, password }),
      dispatcher: this.opts.dispatcher,
    });
    const text = await res.text();
    if (!res.ok) throw new TbError(res.status, '/api/noauth/activate', text);
  }

  // ---- profiles -----------------------------------------------------------------------------

  async getDeviceProfileByName(name: string): Promise<TbEntity | null> {
    const page = await this.request<TbPage<TbEntity>>(
      'GET',
      `/api/deviceProfiles?pageSize=100&page=0&textSearch=${encodeURIComponent(name)}`,
    );
    return page.data.find((p) => p.name === name) ?? null;
  }

  async saveDeviceProfile(profile: TbEntity): Promise<TbEntity> {
    return this.request('POST', '/api/deviceProfile', profile);
  }

  async getAssetProfileByName(name: string): Promise<TbEntity | null> {
    const page = await this.request<TbPage<TbEntity>>(
      'GET',
      `/api/assetProfiles?pageSize=100&page=0&textSearch=${encodeURIComponent(name)}`,
    );
    return page.data.find((p) => p.name === name) ?? null;
  }

  async saveAssetProfile(profile: TbEntity): Promise<TbEntity> {
    return this.request('POST', '/api/assetProfile', profile);
  }

  // ---- devices and assets -------------------------------------------------------------------

  async saveDevice(device: TbDevice, accessToken?: string): Promise<TbDevice> {
    const q = accessToken ? `?accessToken=${encodeURIComponent(accessToken)}` : '';
    return this.request('POST', `/api/device${q}`, device);
  }

  async getTenantDeviceByName(name: string): Promise<TbDevice | null> {
    try {
      return await this.request<TbDevice>(
        'GET',
        `/api/tenant/devices?deviceName=${encodeURIComponent(name)}`,
      );
    } catch (err) {
      if (err instanceof TbError && err.status === 404) return null;
      throw err;
    }
  }

  async deleteDevice(id: string): Promise<void> {
    await this.request('DELETE', `/api/device/${id}`);
  }

  async saveAsset(asset: TbAsset): Promise<TbAsset> {
    return this.request('POST', '/api/asset', asset);
  }

  async getTenantAssetByName(name: string): Promise<TbAsset | null> {
    try {
      return await this.request<TbAsset>(
        'GET',
        `/api/tenant/assets?assetName=${encodeURIComponent(name)}`,
      );
    } catch (err) {
      if (err instanceof TbError && err.status === 404) return null;
      throw err;
    }
  }

  async deleteAsset(id: string): Promise<void> {
    await this.request('DELETE', `/api/asset/${id}`);
  }

  async saveRelation(from: TbId, to: TbId, type = 'Contains'): Promise<void> {
    await this.request('POST', '/api/relation', { from, to, type, typeGroup: 'COMMON' });
  }

  async saveServerAttributes(
    entityType: 'DEVICE' | 'ASSET',
    entityId: string,
    attributes: Record<string, string | number | boolean>,
  ): Promise<void> {
    await this.request(
      'POST',
      `/api/plugins/telemetry/${entityType}/${entityId}/attributes/SERVER_SCOPE`,
      attributes,
    );
  }

  // ---- telemetry ----------------------------------------------------------------------------

  async getLatestTimeseries(deviceId: string, keys?: string[]): Promise<TbTimeseries> {
    const q = keys?.length ? `?keys=${encodeURIComponent(keys.join(','))}` : '';
    return this.request('GET', `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries${q}`);
  }

  async getTimeseries(
    deviceId: string,
    params: {
      keys: string[];
      startTs: number;
      endTs: number;
      interval?: number;
      agg?: 'AVG' | 'SUM' | 'MAX' | 'MIN' | 'COUNT' | 'NONE';
      limit?: number;
    },
  ): Promise<TbTimeseries> {
    const sp = new URLSearchParams({
      keys: params.keys.join(','),
      startTs: String(params.startTs),
      endTs: String(params.endTs),
    });
    if (params.interval) sp.set('interval', String(params.interval));
    if (params.agg) sp.set('agg', params.agg);
    if (params.limit) sp.set('limit', String(params.limit));
    return this.request('GET', `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?${sp}`);
  }

  /** Bulk writes may take a while when the core is busy; they get a longer timeout. */
  static readonly BULK_WRITE_TIMEOUT_MS = 60_000;

  /**
   * Writes historical points straight to the timeseries store (REST writes bypass the rule chain,
   * so they raise no alarms and post no events).
   */
  async postTelemetry(
    deviceId: string,
    points: { ts: number; values: Record<string, unknown> }[],
  ): Promise<void> {
    await this.request(
      'POST',
      `/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/ANY`,
      points,
      true,
      TbClient.BULK_WRITE_TIMEOUT_MS,
    );
  }

  /** Deletes stored points of the keys inside [startTs, endTs] (backfill --purge). */
  async deleteTimeseries(
    deviceId: string,
    keys: string[],
    startTs: number,
    endTs: number,
  ): Promise<void> {
    const sp = new URLSearchParams({
      keys: keys.join(','),
      startTs: String(startTs),
      endTs: String(endTs),
      deleteAllDataForKeys: 'false',
      rewriteLatestIfDeleted: 'false',
    });
    await this.request(
      'DELETE',
      `/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/delete?${sp}`,
    );
  }

  // ---- RPC ----------------------------------------------------------------------------------

  async rpcOneway(deviceId: string, method: RpcMethod | string, params: unknown): Promise<void> {
    await this.request('POST', `/api/rpc/oneway/${deviceId}`, { method, params });
  }

  async rpcTwoway<T = unknown>(
    deviceId: string,
    method: RpcMethod | string,
    params: unknown,
    timeoutMs = 5000,
  ): Promise<T> {
    return this.request('POST', `/api/rpc/twoway/${deviceId}`, {
      method,
      params,
      timeout: timeoutMs,
    });
  }

  // ---- alarms -------------------------------------------------------------------------------

  async getAlarms(
    entityType: 'DEVICE' | 'ASSET',
    entityId: string,
    pageSize = 50,
  ): Promise<TbPage<TbAlarm>> {
    return this.request('GET', `/api/alarm/${entityType}/${entityId}?pageSize=${pageSize}&page=0`);
  }

  async ackAlarm(alarmId: string): Promise<void> {
    await this.request('POST', `/api/alarm/${alarmId}/ack`);
  }

  // ---- rule chains and dashboards -----------------------------------------------------------

  async getRuleChains(): Promise<TbRuleChain[]> {
    const page = await this.request<TbPage<TbRuleChain>>(
      'GET',
      '/api/ruleChains?pageSize=100&page=0',
    );
    return page.data;
  }

  async saveRuleChain(chain: TbRuleChain): Promise<TbRuleChain> {
    return this.request('POST', '/api/ruleChain', chain);
  }

  async saveRuleChainMetadata(metadata: TbRuleChainMetadata): Promise<TbRuleChainMetadata> {
    return this.request('POST', '/api/ruleChain/metadata', metadata);
  }

  async setRootRuleChain(id: string): Promise<void> {
    await this.request('POST', `/api/ruleChain/${id}/root`);
  }

  async saveDashboard(dashboard: Record<string, unknown>): Promise<TbEntity> {
    return this.request('POST', '/api/dashboard', dashboard);
  }

  async findDashboardByTitle(title: string): Promise<TbEntity | null> {
    const page = await this.request<TbPage<TbEntity & { title: string }>>(
      'GET',
      `/api/tenant/dashboards?pageSize=100&page=0&textSearch=${encodeURIComponent(title)}`,
    );
    return page.data.find((d) => d.title === title) ?? null;
  }
}

/** Wraps a TbError into a problem+json-safe upstream error without leaking the body. */
export function asUpstreamError(err: unknown, action: string): Error {
  if (err instanceof TbError) return upstream(`ThingsBoard ${action} failed (${err.status})`);
  return upstream(`ThingsBoard ${action} failed`);
}
