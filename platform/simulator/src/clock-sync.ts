import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import { ClockSnapshotSchema } from '@platform/shared/clock';
import type { Logger } from './mqtt.js';
import type { Simulation } from './simulation.js';

export interface ClockSyncOptions {
  apiUrl: string;
  internalToken: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The API owns each tenant's business clock and pushes changes to PUT /clock. After a restart the
 * simulator would otherwise come back on the real clock while the demo is at 20:00, so it pulls
 * the current state once at startup. Failures are logged and leave the clock live.
 */
export async function syncClocksFromApi(sim: Simulation, opts: ClockSyncOptions): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let synced = 0;
  for (const tenant of sim.tenantKeys()) {
    const url = `${opts.apiUrl.replace(/\/$/, '')}/internal/clock/${encodeURIComponent(tenant)}`;
    try {
      const res = await fetchImpl(url, {
        headers: { [INTERNAL_TOKEN_HEADER]: opts.internalToken },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
      });
      if (!res.ok) {
        opts.log.warn({ tenant, status: res.status }, 'clock sync: API answered with an error');
        continue;
      }
      const snapshot = ClockSnapshotSchema.parse(await res.json());
      if (!snapshot.live) sim.setClock(tenant, snapshot.state);
      synced++;
    } catch (err) {
      opts.log.warn(
        { tenant, err: err instanceof Error ? err.message : String(err) },
        'clock sync: API unreachable, staying on the real clock',
      );
    }
  }
  return synced;
}
