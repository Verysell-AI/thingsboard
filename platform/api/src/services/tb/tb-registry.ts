import type { Dispatcher } from 'undici';
import type { Config } from '../../config.js';
import { TbClient } from './tb.client.js';

/** Hands out one cached TbClient per identity: sysadmin, or a tenant's svc-api / svc-dashboards user. */
export class TbClientRegistry {
  private readonly clients = new Map<string, TbClient>();

  constructor(
    private readonly config: Config,
    private readonly dispatcher?: Dispatcher,
  ) {}

  serviceEmail(tenantKey: string, account: 'svc-api' | 'svc-dashboards' = 'svc-api'): string {
    return `${account}@${tenantKey}.${this.config.TENANT_DOMAIN}`;
  }

  sysadmin(password = this.config.TB_SYSADMIN_PASSWORD): TbClient {
    const key = `sysadmin:${password}`;
    let c = this.clients.get(key);
    if (!c) {
      c = new TbClient({
        baseUrl: this.config.TB_URL,
        email: this.config.TB_SYSADMIN_EMAIL,
        password,
        dispatcher: this.dispatcher,
      });
      this.clients.set(key, c);
    }
    return c;
  }

  forTenant(tenantKey: string, account: 'svc-api' | 'svc-dashboards' = 'svc-api'): TbClient {
    const email = this.serviceEmail(tenantKey, account);
    let c = this.clients.get(email);
    if (!c) {
      c = new TbClient({
        baseUrl: this.config.TB_URL,
        email,
        password: this.config.TB_SERVICE_PASSWORD,
        dispatcher: this.dispatcher,
      });
      this.clients.set(email, c);
    }
    return c;
  }

  /** Drops the cached clients of a tenant whose ThingsBoard users no longer exist. */
  forget(tenantKey: string): void {
    for (const account of ['svc-api', 'svc-dashboards'] as const)
      this.clients.delete(this.serviceEmail(tenantKey, account));
  }

  reachable(): Promise<boolean> {
    return TbClient.reachable(this.config.TB_URL, this.dispatcher);
  }
}
