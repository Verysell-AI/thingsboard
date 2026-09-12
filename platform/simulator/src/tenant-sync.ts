import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import { SimulatedTenantsResponseSchema } from '@platform/shared/dto';
import type { Logger } from './mqtt.js';
import type { Simulation } from './simulation.js';
import type { TenantWorld } from './world.js';

export interface TenantSyncOptions {
  apiUrl: string;
  internalToken: string;
  log: Logger;
  loadWorld: (tenantKey: string) => TenantWorld;
  /** How often the list is re-read from the API. */
  pollMs: number;
  /** Runs after one or more tenants were added, e.g. to pull their clocks. */
  onAdded?: (keys: string[]) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Delay between attempts while waiting for the API at startup. */
  retryMs?: number;
  /** Real clock source (tests inject a fake). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Keeps the set of simulated tenants equal to what the API reports (tenants with `simulated` on).
 * The API also pushes changes to PUT/DELETE /tenants/:key; polling covers a push that was lost
 * while the simulator was down. A tenant whose dataset cannot be read is logged and skipped, so
 * one bad key never stops the others.
 */
export class TenantSync {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sim: Simulation,
    private readonly opts: TenantSyncOptions,
  ) {}

  /** Reads the list from the API; null when the API could not be reached or answered badly. */
  async fetchKeys(): Promise<string[] | null> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.apiUrl.replace(/\/$/, '')}/internal/tenants/simulated`;
    try {
      const res = await fetchImpl(url, {
        headers: { [INTERNAL_TOKEN_HEADER]: this.opts.internalToken },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
      });
      if (!res.ok) {
        this.opts.log.warn({ status: res.status }, 'tenant sync: API answered with an error');
        return null;
      }
      return SimulatedTenantsResponseSchema.parse(await res.json()).items.map((t) => t.key);
    } catch (err) {
      this.opts.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'tenant sync: API unreachable',
      );
      return null;
    }
  }

  /** Adds missing tenants and removes the ones no longer simulated. Returns what changed. */
  async reconcile(keys: readonly string[]): Promise<{ added: string[]; removed: string[] }> {
    const wanted = new Set(keys);
    const added: string[] = [];
    const removed: string[] = [];
    for (const key of this.sim.tenantKeys()) {
      if (!wanted.has(key) && this.sim.removeTenant(key)) removed.push(key);
    }
    for (const key of wanted) {
      if (this.sim.registry(key)) continue;
      try {
        const world = this.opts.loadWorld(key);
        this.sim.addTenant(world);
        this.opts.log.info({ tenant: key, devices: world.devices.length }, 'loaded tenant dataset');
        added.push(key);
      } catch (err) {
        this.opts.log.warn(
          { tenant: key, err: err instanceof Error ? err.message : String(err) },
          'tenant sync: dataset could not be loaded for this tenant',
        );
      }
    }
    if (added.length > 0 && this.opts.onAdded) await this.opts.onAdded(added);
    return { added, removed };
  }

  /** Startup: wait until the API answers once, then load that list. */
  async initial(): Promise<void> {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const retryMs = this.opts.retryMs ?? 5_000;
    for (let attempt = 1; ; attempt++) {
      const keys = await this.fetchKeys();
      if (keys) {
        await this.reconcile(keys);
        this.opts.log.info({ tenants: keys }, 'simulated tenants read from the API');
        return;
      }
      this.opts.log.info({ attempt, retryMs }, 'tenant sync: waiting for the API');
      await sleep(retryMs);
    }
  }

  /** Re-reads the list every `pollMs`; a failed read changes nothing. */
  startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.fetchKeys().then((keys) => (keys ? this.reconcile(keys) : undefined));
    }, this.opts.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
