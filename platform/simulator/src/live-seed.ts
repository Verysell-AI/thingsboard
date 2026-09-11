import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import { LiveSnapshotSchema } from '@platform/shared/dto';
import type { Logger } from './mqtt.js';
import type { Simulation } from './simulation.js';

export interface LiveSeedOptions {
  apiUrl: string;
  internalToken: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Seeds cumulative device state (energy counters, AC runtime hours) from the platform's latest
 * known values so a simulator restart continues the meters instead of resetting them to zero.
 * Failures are logged and leave the devices at their initial state.
 */
export async function seedFromLiveState(sim: Simulation, opts: LiveSeedOptions): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let seeded = 0;
  for (const tenant of sim.tenantKeys()) {
    const url = `${opts.apiUrl.replace(/\/$/, '')}/internal/live/${encodeURIComponent(tenant)}`;
    try {
      const res = await fetchImpl(url, {
        headers: { [INTERNAL_TOKEN_HEADER]: opts.internalToken },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        opts.log.warn({ tenant, status: res.status }, 'live seed: API answered with an error');
        continue;
      }
      const snapshot = LiveSnapshotSchema.parse(await res.json());
      const registry = sim.registry(tenant);
      if (!registry) continue;
      for (const d of snapshot.devices) {
        const device = registry.get(d.deviceCode);
        if (device && device.seedCounters(d.values)) seeded++;
      }
    } catch (err) {
      opts.log.warn(
        { tenant, err: err instanceof Error ? err.message : String(err) },
        'live seed: API unreachable, meters start from zero',
      );
    }
  }
  return seeded;
}
