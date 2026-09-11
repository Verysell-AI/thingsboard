import {
  ClockStateSchema,
  applyClockCommand,
  clockSnapshot,
  liveClock,
  virtualNow,
  type ClockCommand,
  type ClockSnapshot,
  type ClockState,
} from '@platform/shared/clock';
import { redisKeys } from '@platform/shared/contracts';
import type { RedisLike } from '../../lib/redis.js';
import type { ReplayService } from '../live/replay.service.js';

/** Where clock changes are pushed so virtual devices follow (the simulator, in demo mode). */
export interface ClockSink {
  setClock(tenantKey: string, state: ClockState): Promise<unknown>;
}

/**
 * The tenant business clock ("time machine", context §8.1). The state lives in Redis so every API
 * replica and worker computes the same virtual time; changes are pushed to the simulator first (if
 * that fails nothing changes) and then announced to browsers as a `clock` live event.
 *
 * Automations, bookings and personas must read time through `now(tenantKey)`; telemetry timestamps
 * and audit rows stay on the real clock.
 */
export class ClockService {
  constructor(
    private readonly redis: RedisLike,
    private readonly replay: ReplayService,
    private readonly sink: ClockSink,
    readonly timeZone: string,
    private readonly realNow: () => number = Date.now,
    private onChanged: ((tenantKey: string, state: ClockState) => Promise<void>) | null = null,
  ) {}

  /** Called after every clock change (the automation engine runs an immediate tick). */
  onChange(handler: (tenantKey: string, state: ClockState) => Promise<void>): void {
    this.onChanged = handler;
  }

  async getState(tenantKey: string): Promise<ClockState> {
    const raw = await this.redis.hgetall(redisKeys.clock(tenantKey));
    if (!raw || !raw.speed) return liveClock();
    const parsed = ClockStateSchema.safeParse({
      anchorRealMs: Number(raw.anchorRealMs),
      anchorVirtualMs: Number(raw.anchorVirtualMs),
      speed: Number(raw.speed),
    });
    return parsed.success ? parsed.data : liveClock();
  }

  /** Business time of the tenant right now. */
  async now(tenantKey: string): Promise<number> {
    return virtualNow(await this.getState(tenantKey), this.realNow());
  }

  async snapshot(tenantKey: string): Promise<ClockSnapshot> {
    return clockSnapshot(tenantKey, await this.getState(tenantKey), this.realNow(), this.timeZone);
  }

  async apply(tenantKey: string, command: ClockCommand): Promise<ClockSnapshot> {
    const current = await this.getState(tenantKey);
    const real = this.realNow();
    const next = applyClockCommand(current, command, real, this.timeZone);
    await this.sink.setClock(tenantKey, next);
    await this.redis.hset(redisKeys.clock(tenantKey), {
      anchorRealMs: String(next.anchorRealMs),
      anchorVirtualMs: String(next.anchorVirtualMs),
      speed: String(next.speed),
    });
    await this.replay.append(tenantKey, {
      kind: 'clock',
      tenantKey,
      ts: real,
      state: next,
      virtualNow: virtualNow(next, real),
      timeZone: this.timeZone,
    });
    if (this.onChanged) await this.onChanged(tenantKey, next).catch(() => undefined);
    return clockSnapshot(tenantKey, next, real, this.timeZone);
  }
}
