import { fetch, type Dispatcher } from 'undici';
import type {
  ScenarioName,
  ScenarioParams,
  ScenarioResult,
  SimulatorState,
  SimulatorTenant,
} from '@platform/shared/dto';
import type { ClockSnapshot, ClockState } from '@platform/shared/clock';
import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import { AppError, notImplemented, upstream } from '../../lib/errors.js';

/** Proxies scenario-console actions to the simulator; only reachable for tenants in demo mode. */
export class ConsoleService {
  constructor(
    private readonly simulatorUrl: string,
    private readonly internalToken: string,
    private readonly dispatcher?: Dispatcher,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res;
    try {
      res = await fetch(`${this.simulatorUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: this.internalToken,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw upstream('Simulator unreachable');
    }
    const text = await res.text();
    if (res.status === 501) throw notImplemented(safeMessage(text) ?? 'Scenario not implemented');
    if (!res.ok)
      throw new AppError(
        res.status >= 500 ? 502 : res.status,
        'Simulator error',
        safeMessage(text),
      );
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  runScenario(
    tenantKey: string,
    name: ScenarioName,
    params: ScenarioParams,
  ): Promise<ScenarioResult> {
    return this.call('POST', `/scenario/${name}?tenant=${encodeURIComponent(tenantKey)}`, params);
  }

  /** Pushes a tenant's business clock so virtual devices follow the time machine. */
  setClock(tenantKey: string, state: ClockState): Promise<ClockSnapshot> {
    return this.call('PUT', '/clock', { tenant: tenantKey, state });
  }

  state(tenantKey: string): Promise<SimulatorState> {
    return this.call('GET', `/state?tenant=${encodeURIComponent(tenantKey)}`);
  }

  addDevice(input: {
    tenant: string;
    code: string;
    type: string;
    accessToken: string;
    attrs: Record<string, string | number | boolean>;
  }): Promise<void> {
    return this.call('POST', `/devices?tenant=${encodeURIComponent(input.tenant)}`, input);
  }

  /** Tells the simulator to load (or reload) a tenant's world; it reads the dataset itself. */
  syncTenant(tenantKey: string): Promise<SimulatorTenant> {
    return this.call('PUT', `/tenants/${encodeURIComponent(tenantKey)}`);
  }

  /** Stops driving a tenant's devices; a tenant the simulator does not know is fine. */
  async removeTenant(tenantKey: string): Promise<void> {
    try {
      await this.call('DELETE', `/tenants/${encodeURIComponent(tenantKey)}`);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) return;
      throw err;
    }
  }

  removeDevice(tenantKey: string, code: string): Promise<void> {
    return this.call(
      'DELETE',
      `/devices/${encodeURIComponent(code)}?tenant=${encodeURIComponent(tenantKey)}`,
    );
  }
}

function safeMessage(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { message?: string; detail?: string };
    return j.detail ?? j.message;
  } catch {
    return text.slice(0, 200) || undefined;
  }
}
