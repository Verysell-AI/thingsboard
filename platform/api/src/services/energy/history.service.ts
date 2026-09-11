import type { HistoryResponse, SeriesPoint } from '@platform/shared/dto';
import type { RedisLike } from '../../lib/redis.js';
import { badRequest } from '../../lib/errors.js';
import type { TbClient, TbTimeseries } from '../tb/tb.client.js';

export type HistoryAgg = 'AVG' | 'SUM' | 'MAX' | 'MIN' | 'NONE';

export interface HistoryRequest {
  keys: string[];
  from: number;
  to: number;
  interval: number;
  agg: HistoryAgg;
}

export interface TbHistorySource {
  forTenant(tenantKey: string): Pick<TbClient, 'getTimeseries'>;
}

export const HISTORY_MAX_RANGE_MS = 35 * 24 * 3_600_000;
export const HISTORY_MAX_POINTS = 5000;
export const HISTORY_CACHE_SECONDS = 30;
export const DEFAULT_HISTORY_RANGE_MS = 24 * 3_600_000;
export const DEFAULT_HISTORY_INTERVAL_MS = 15 * 60_000;

/**
 * The only reader of ThingsBoard telemetry history. Ranges are capped, responses cached briefly in
 * Redis so a dashboard with many tiles does not hammer the core.
 */
export class HistoryService {
  constructor(
    private readonly tb: TbHistorySource,
    private readonly redis: RedisLike,
    private readonly cacheSeconds = HISTORY_CACHE_SECONDS,
  ) {}

  /** Normalises a raw query (defaults, caps) relative to `now`. */
  static normalise(
    query: { keys: string; from?: number; to?: number; interval?: number; agg?: HistoryAgg },
    now: number,
  ): HistoryRequest {
    const keys = query.keys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length === 0) throw badRequest('keys is required');
    const to = query.to ?? now;
    const from = query.from ?? to - DEFAULT_HISTORY_RANGE_MS;
    if (from >= to) throw badRequest('from must be before to');
    if (to - from > HISTORY_MAX_RANGE_MS) throw badRequest('range longer than 35 days');
    const agg = query.agg ?? 'AVG';
    let interval = query.interval ?? DEFAULT_HISTORY_INTERVAL_MS;
    if (agg !== 'NONE') {
      const minInterval = Math.ceil((to - from) / HISTORY_MAX_POINTS);
      if (interval < minInterval) interval = minInterval;
    }
    return { keys, from, to, interval, agg };
  }

  async series(
    tenantKey: string,
    tbDeviceId: string,
    deviceCode: string,
    req: HistoryRequest,
  ): Promise<HistoryResponse> {
    const cacheKey = `history:${tenantKey}:${tbDeviceId}:${req.keys.join(',')}:${req.from}:${req.to}:${req.interval}:${req.agg}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as HistoryResponse;
    const raw = await this.tb.forTenant(tenantKey).getTimeseries(tbDeviceId, {
      keys: req.keys,
      startTs: req.from,
      endTs: req.to,
      ...(req.agg === 'NONE' ? {} : { interval: req.interval, agg: req.agg }),
      limit: HISTORY_MAX_POINTS,
    });
    const response: HistoryResponse = {
      deviceCode,
      from: req.from,
      to: req.to,
      interval: req.interval,
      agg: req.agg,
      series: toSeries(raw, req.keys),
    };
    await this.redis.set(cacheKey, JSON.stringify(response), 'EX', this.cacheSeconds);
    return response;
  }

  /** Single aggregate over a whole range (e.g. the meter reading at the start of the day). */
  async aggregate(
    tenantKey: string,
    tbDeviceId: string,
    key: string,
    from: number,
    to: number,
    agg: Exclude<HistoryAgg, 'NONE'>,
  ): Promise<number | null> {
    if (to <= from) return null;
    const res = await this.series(tenantKey, tbDeviceId, tbDeviceId, {
      keys: [key],
      from,
      to,
      interval: to - from,
      agg,
    });
    const points = res.series[key] ?? [];
    return points.length ? (points[0]!.value ?? null) : null;
  }
}

export function toSeries(raw: TbTimeseries, keys: string[]): Record<string, SeriesPoint[]> {
  const out: Record<string, SeriesPoint[]> = {};
  for (const key of keys) {
    const points = (raw[key] ?? [])
      .map((p) => ({ ts: p.ts, value: Number(p.value) }))
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.ts - b.ts);
    out[key] = points;
  }
  return out;
}
