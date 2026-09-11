import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LiveSnapshotSchema } from '@platform/shared/dto';
import { requireInternalToken } from '../../../hooks/index.js';

/**
 * Latest known device values of a tenant, for the simulator: on start it seeds cumulative counters
 * (energy, AC runtime) from here so a restart does not reset meters to zero. Counter overrides left
 * by the backfill are applied once (the larger value wins) so history and live join without a step.
 */
const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/:tenantKey',
    {
      preHandler: [requireInternalToken],
      schema: {
        tags: ['internal'],
        hide: true,
        params: z.object({ tenantKey: z.string() }),
        response: { 200: LiveSnapshotSchema },
      },
    },
    async (request) => {
      const { services } = fastify;
      const [devices, lastEventId, overrides] = await Promise.all([
        services.liveState.snapshot(request.params.tenantKey),
        services.replay.lastId(request.params.tenantKey),
        services.liveState.takeCounterOverrides(request.params.tenantKey),
      ]);
      const merged = devices.map((d) => {
        const o = overrides[d.deviceCode];
        if (!o) return d;
        const values = { ...d.values };
        for (const [k, v] of Object.entries(o)) {
          const current = Number(values[k]);
          const next = Number(v);
          if (Number.isFinite(next) && (!Number.isFinite(current) || next > current))
            values[k] = next;
        }
        return { ...d, values };
      });
      for (const [code, o] of Object.entries(overrides))
        if (!devices.some((d) => d.deviceCode === code))
          merged.push({
            deviceCode: code,
            deviceType: null,
            tbDeviceId: null,
            room: null,
            online: false,
            ts: null,
            values: o,
            activeAlarms: [],
          });
      return { tenantKey: request.params.tenantKey, lastEventId, devices: merged };
    },
  );
};

export default routes;
