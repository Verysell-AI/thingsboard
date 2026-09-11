import type { DeviceLiveState, TelemetryValues } from '@platform/shared';
import { redisKeys } from '@platform/shared/contracts';
import type { RedisLike } from '../../lib/redis.js';

/**
 * Latest device state in Redis so every API replica agrees:
 *   live:{tenant}:{code} → hash {values, online, ts, deviceType, room, tbDeviceId, alarms}
 *   live:{tenant}:__devices → set of codes
 */
export class LiveStateService {
  constructor(private readonly redis: RedisLike) {}

  async upsert(
    tenantKey: string,
    deviceCode: string,
    patch: {
      values?: TelemetryValues;
      online?: boolean;
      ts?: number;
      deviceType?: string | null;
      room?: string | null;
      tbDeviceId?: string | null;
      alarmAdd?: string;
      alarmRemove?: string;
    },
  ): Promise<DeviceLiveState> {
    const key = redisKeys.live(tenantKey, deviceCode);
    const current = await this.redis.hgetall(key);
    const state = parseState(deviceCode, current);
    if (patch.values) state.values = { ...state.values, ...patch.values };
    if (patch.online !== undefined) state.online = patch.online;
    if (patch.ts !== undefined) state.ts = Math.max(state.ts ?? 0, patch.ts);
    if (patch.deviceType !== undefined) state.deviceType = patch.deviceType;
    if (patch.room !== undefined) state.room = patch.room;
    if (patch.tbDeviceId !== undefined) state.tbDeviceId = patch.tbDeviceId;
    if (patch.alarmAdd && !state.activeAlarms.includes(patch.alarmAdd))
      state.activeAlarms.push(patch.alarmAdd);
    if (patch.alarmRemove)
      state.activeAlarms = state.activeAlarms.filter((a) => a !== patch.alarmRemove);
    await this.redis.hset(key, serializeState(state));
    await this.redis.sadd(redisKeys.liveIndex(tenantKey), deviceCode);
    return state;
  }

  async get(tenantKey: string, deviceCode: string): Promise<DeviceLiveState | null> {
    const raw = await this.redis.hgetall(redisKeys.live(tenantKey, deviceCode));
    if (!raw || Object.keys(raw).length === 0) return null;
    return parseState(deviceCode, raw);
  }

  async snapshot(tenantKey: string): Promise<DeviceLiveState[]> {
    const codes = await this.redis.smembers(redisKeys.liveIndex(tenantKey));
    const out: DeviceLiveState[] = [];
    for (const code of codes.sort()) {
      const s = await this.get(tenantKey, code);
      if (s) out.push(s);
    }
    return out;
  }

  async isEmpty(tenantKey: string): Promise<boolean> {
    return (await this.redis.scard(redisKeys.liveIndex(tenantKey))) === 0;
  }

  /**
   * Counter values the next simulator start must continue from (energy, AC runtime), written by
   * the backfill. Served once by GET /internal/live/:tenant and then dropped, so the hand-off works
   * whatever the running simulator publishes in between.
   */
  async setCounterOverrides(tenantKey: string, byDevice: Record<string, string>): Promise<void> {
    const key = counterOverridesKey(tenantKey);
    await this.redis.del(key);
    if (Object.keys(byDevice).length) await this.redis.hset(key, byDevice);
  }

  /** Reads and clears the counter overrides; empty when none are pending. */
  async takeCounterOverrides(tenantKey: string): Promise<Record<string, TelemetryValues>> {
    const key = counterOverridesKey(tenantKey);
    const raw = await this.redis.hgetall(key);
    if (!raw || Object.keys(raw).length === 0) return {};
    await this.redis.del(key);
    const out: Record<string, TelemetryValues> = {};
    for (const [code, json] of Object.entries(raw)) {
      try {
        out[code] = JSON.parse(json) as TelemetryValues;
      } catch {
        // ignore a corrupt entry
      }
    }
    return out;
  }

  async clear(tenantKey: string): Promise<void> {
    const codes = await this.redis.smembers(redisKeys.liveIndex(tenantKey));
    const keys = codes.map((c) => redisKeys.live(tenantKey, c));
    keys.push(redisKeys.liveIndex(tenantKey));
    await this.redis.del(...keys);
  }
}

const counterOverridesKey = (tenantKey: string) => `live:${tenantKey}:__counters`;

function parseState(deviceCode: string, raw: Record<string, string>): DeviceLiveState {
  return {
    deviceCode,
    deviceType: raw.deviceType ?? null,
    tbDeviceId: raw.tbDeviceId ?? null,
    room: raw.room ?? null,
    online: raw.online === '1',
    ts: raw.ts ? Number(raw.ts) : null,
    values: raw.values ? (JSON.parse(raw.values) as TelemetryValues) : {},
    activeAlarms: raw.alarms ? (JSON.parse(raw.alarms) as string[]) : [],
  };
}

function serializeState(s: DeviceLiveState): Record<string, string> {
  return {
    deviceType: s.deviceType ?? '',
    tbDeviceId: s.tbDeviceId ?? '',
    room: s.room ?? '',
    online: s.online ? '1' : '0',
    ts: s.ts === null ? '' : String(s.ts),
    values: JSON.stringify(s.values),
    alarms: JSON.stringify(s.activeAlarms),
  };
}
