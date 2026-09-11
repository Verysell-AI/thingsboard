import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { LiveEvent } from '@platform/shared/contracts';
import { redisKeys } from '@platform/shared/contracts';
import { listDevicesByTenant } from '../db/device-lookup.js';
import { LiveGateway } from '../services/live/live-gateway.js';

declare module 'fastify' {
  interface FastifyInstance {
    live: LiveGateway;
  }
}

export interface LivePluginOptions {
  /** Skip the startup rebuild from ThingsBoard (tests). */
  skipLiveRebuild?: boolean;
}

/**
 * Socket.IO feed to browsers. Every replica subscribes to events:* on Redis and delivers to its own
 * sockets, so a ThingsBoard webhook handled by any replica reaches every browser.
 */
export default fp<LivePluginOptions>(
  async (fastify, opts) => {
    const { services } = fastify;
    const adapter =
      services.redisPub && services.redisSub
        ? createAdapter(services.redisPub, services.redisSub.duplicate({ enableReadyCheck: false }))
        : undefined;
    const gateway = new LiveGateway(
      fastify.server,
      () => services.auth,
      services.liveState,
      services.replay,
      fastify.log,
      { adapter },
    );
    fastify.decorate('live', gateway);

    const sub = services.redisSub;
    if (sub) {
      sub.on('error', (err: Error) => fastify.log.warn({ err }, 'live event subscriber error'));
      sub.on('ready', () => fastify.log.info('live event subscriber connected'));
      await sub.psubscribe('events:*');
      sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
        const tenantKey = channel.slice('events:'.length);
        try {
          gateway.deliver(tenantKey, JSON.parse(message) as LiveEvent);
        } catch (err) {
          fastify.log.warn({ err, channel }, 'bad live event payload');
        }
      });
    }

    fastify.addHook('onClose', async () => {
      await gateway.close();
    });

    if (!opts.skipLiveRebuild) {
      fastify.addHook('onReady', async () => {
        // Runs in the background so a slow or absent ThingsBoard never blocks startup.
        void rebuildLiveState(fastify).catch((err) =>
          fastify.log.warn({ err }, 'live state rebuild failed'),
        );
      });
    }
  },
  { name: 'live', dependencies: ['services', 'auth'] },
);

async function rebuildLiveState(fastify: FastifyInstance): Promise<void> {
  const { services } = fastify;
  const byTenant = await listDevicesByTenant(services.db.admin);
  for (const [tenantKey, devices] of byTenant) {
    if (!(await services.liveState.isEmpty(tenantKey))) continue;
    const tb = services.tb.forTenant(tenantKey);
    let restored = 0;
    const queue = [...devices];
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        try {
          const series = await tb.getLatestTimeseries(d.tbDeviceId);
          const values: Record<string, number | string> = {};
          let ts = 0;
          for (const [k, points] of Object.entries(series)) {
            const p = points[0];
            if (!p) continue;
            const n = Number(p.value);
            values[k] = Number.isFinite(n) && p.value.trim() !== '' ? n : p.value;
            ts = Math.max(ts, p.ts);
          }
          await services.liveState.upsert(tenantKey, d.deviceCode, {
            values,
            ts: ts || undefined,
            online: false,
            deviceType: d.deviceType,
            room: d.room,
            tbDeviceId: d.tbDeviceId,
          });
          restored++;
        } catch (err) {
          fastify.log.debug({ err, device: d.deviceCode }, 'latest telemetry unavailable');
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    fastify.log.info(
      { tenantKey, restored, total: devices.length, key: redisKeys.liveIndex(tenantKey) },
      'live state rebuilt',
    );
  }
}
