import type { LiveEvent } from '@platform/shared/contracts';

/** A LiveEvent before the replay stream assigned its id. */
export type LiveEventInput = LiveEvent extends infer E
  ? E extends LiveEvent
    ? Omit<E, 'id'>
    : never
  : never;
import { REPLAY_WINDOW_MS, redisKeys } from '@platform/shared/contracts';
import type { RedisLike } from '../../lib/redis.js';

/**
 * Appends events to the tenant's replay stream (kept ~60 s), publishes them on the tenant channel,
 * and serves replays for reconnecting clients.
 */
export class ReplayService {
  constructor(
    private readonly redis: RedisLike,
    private readonly now: () => number = Date.now,
  ) {}

  /** Stores the event, assigns its stream id, publishes it. Returns the event with `id` set. */
  async append(tenantKey: string, event: LiveEventInput): Promise<LiveEvent> {
    const stream = redisKeys.replayStream(tenantKey);
    const minId = String(this.now() - REPLAY_WINDOW_MS);
    const id = await this.redis.xadd(
      stream,
      'MINID',
      '~',
      minId,
      '*',
      'event',
      JSON.stringify({ ...event, id: '' }),
    );
    const withId = { ...event, id: id ?? `${this.now()}-0` } as LiveEvent;
    await this.redis.publish(redisKeys.eventsChannel(tenantKey), JSON.stringify(withId));
    return withId;
  }

  /** Events strictly newer than `lastEventId` (exclusive), oldest first. */
  async since(tenantKey: string, lastEventId: string | null): Promise<LiveEvent[]> {
    const stream = redisKeys.replayStream(tenantKey);
    const start = lastEventId ? `(${lastEventId}` : String(this.now() - REPLAY_WINDOW_MS);
    const entries = await this.redis.xrange(stream, start, '+', 'COUNT', 5000);
    const out: LiveEvent[] = [];
    for (const [id, fields] of entries) {
      const idx = fields.indexOf('event');
      const json = idx >= 0 ? fields[idx + 1] : undefined;
      if (!json) continue;
      const ev = JSON.parse(json) as LiveEvent;
      out.push({ ...ev, id });
    }
    return out;
  }

  async lastId(tenantKey: string): Promise<string | null> {
    const entries = await this.redis.xrevrange(
      redisKeys.replayStream(tenantKey),
      '+',
      '-',
      'COUNT',
      1,
    );
    return entries[0]?.[0] ?? null;
  }
}
