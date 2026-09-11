import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import {
  ENERGY_RANGE_INTERVAL_MS,
  ENERGY_RANGE_MS,
  type DeviceLiveState,
  type EnergyBreakdown,
  type EnergyRange,
  type EnergySummary,
  type EnergyTrend,
  type SeriesPoint,
  type TopConsumers,
} from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, locations, type AssetRow, type LocationRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RedisLike } from '../../lib/redis.js';
import type { ClockService } from '../clock/clock.service.js';
import type { LiveStateService } from '../live/live-state.service.js';
import type { HistoryService } from './history.service.js';

export interface EnergyTenant {
  id: string;
  key: string;
  currency: string;
  tariffPerKwh: number;
}

const CONSUMER_TYPES = ['light', 'ac', 'plug'];
const CACHE_SECONDS = 30;

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Start of the day, the ISO week (Monday) and the month containing `ms`, in the zone. */
export function periodStarts(ms: number, timeZone: string) {
  const p = zonedDateParts(ms, timeZone);
  const day = zonedTimeToEpoch({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
  const daysSinceMonday = (p.weekday + 6) % 7;
  const week = zonedTimeToEpoch(
    { ...p, day: p.day - daysSinceMonday, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  const month = zonedTimeToEpoch({ ...p, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
  return { day, week, month };
}

/** kWh consumed since a meter reading, guarding against resets and missing history. */
export function kwhSince(latest: number | null, atStart: number | null): number | null {
  if (latest === null || atStart === null) return null;
  return round(Math.max(0, latest - atStart));
}

/** Per-bucket energy from a cumulative meter series (differences of successive maxima). */
export function energyPerBucket(cumulative: SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 1; i < cumulative.length; i++) {
    const prev = cumulative[i - 1]!;
    const cur = cumulative[i]!;
    out.push({ ts: cur.ts, value: round(Math.max(0, cur.value - prev.value)) });
  }
  return out;
}

/** Element-wise sum of series that share bucket timestamps. */
export function sumSeries(series: SeriesPoint[][]): SeriesPoint[] {
  const acc = new Map<number, number>();
  for (const s of series) for (const p of s) acc.set(p.ts, (acc.get(p.ts) ?? 0) + p.value);
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, value]) => ({ ts, value: round(value) }));
}

export function meanSeries(series: SeriesPoint[][]): SeriesPoint[] {
  const acc = new Map<number, { sum: number; n: number }>();
  for (const s of series)
    for (const p of s) {
      const cur = acc.get(p.ts) ?? { sum: 0, n: 0 };
      acc.set(p.ts, { sum: cur.sum + p.value, n: cur.n + 1 });
    }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, { sum, n }]) => ({ ts, value: round(sum / n) }));
}

/** Energy figures for the building, floors and rooms, from meters' live values and history. */
export class EnergyService {
  constructor(
    private readonly db: Db,
    private readonly clock: ClockService,
    private readonly live: LiveStateService,
    private readonly history: HistoryService,
    private readonly redis: RedisLike,
    private readonly timeZone: string,
    private waste: {
      wastedToday(tenantKey: string, roomCodes: string[], now: number): Promise<number>;
    } | null = null,
  ) {}

  /** The waste integrator is built after the energy service; wired once both exist. */
  setWaste(waste: NonNullable<EnergyService['waste']>): void {
    this.waste = waste;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await load();
    await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_SECONDS);
    return value;
  }

  private async meters(tenantId: string, type: 'floor_meter' | 'room_meter') {
    return withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ asset: assets, location: locations })
        .from(assets)
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(and(eq(assets.deviceType, type), isNotNull(assets.tbDeviceId))),
    );
  }

  /**
   * Meter reading at the start of a period: the minimum of the cumulative counter between the
   * period start and now. For a monotonic counter that is the first reading of the period, and it
   * still answers when the first minutes have no data or the counter was reset by a restart.
   */
  private async readingAt(
    tenantKey: string,
    meter: AssetRow,
    at: number,
    now: number,
  ): Promise<number | null> {
    try {
      return await this.history.aggregate(
        tenantKey,
        meter.tbDeviceId!,
        'energy_kwh',
        at,
        now,
        'MIN',
      );
    } catch {
      return null;
    }
  }

  async summary(tenant: EnergyTenant): Promise<EnergySummary> {
    return this.cached(`energy:summary:${tenant.key}`, async () => {
      const now = await this.clock.now(tenant.key);
      const starts = periodStarts(now, this.timeZone);
      const meters = await this.meters(tenant.id, 'floor_meter');
      const snapshot = await this.live.snapshot(tenant.key);
      const live = new Map(snapshot.map((d) => [d.deviceCode, d]));
      let powerNowW: number | null = null;
      let kwhToday: number | null = null;
      let kwhWeek: number | null = null;
      let kwhMonth: number | null = null;
      const pfs: number[] = [];
      for (const { asset } of meters) {
        const state = live.get(asset.code);
        const p = state ? num(state.values.power_w) : null;
        if (p !== null) powerNowW = (powerNowW ?? 0) + p;
        const pf = state ? num(state.values.pf) : null;
        if (pf !== null) pfs.push(pf);
        const latest = state ? num(state.values.energy_kwh) : null;
        if (latest === null) continue;
        const [d, w, m] = await Promise.all([
          this.readingAt(tenant.key, asset, starts.day, now),
          this.readingAt(tenant.key, asset, starts.week, now),
          this.readingAt(tenant.key, asset, starts.month, now),
        ]);
        const add = (acc: number | null, v: number | null) => (v === null ? acc : (acc ?? 0) + v);
        kwhToday = add(kwhToday, kwhSince(latest, d));
        kwhWeek = add(kwhWeek, kwhSince(latest, w));
        kwhMonth = add(kwhMonth, kwhSince(latest, m));
      }
      const cost = (kwh: number | null) =>
        kwh === null ? null : round(kwh * tenant.tariffPerKwh, 2);
      const roomMeters = await this.meters(tenant.id, 'room_meter');
      const wastedTodayKwh = this.waste
        ? await this.waste.wastedToday(
            tenant.key,
            roomMeters.map((m) => m.location?.code).filter((c): c is string => Boolean(c)),
            now,
          )
        : null;
      return {
        ts: now,
        currency: tenant.currency,
        tariffPerKwh: tenant.tariffPerKwh,
        powerNowW: powerNowW === null ? null : round(powerNowW, 1),
        kwhToday: kwhToday === null ? null : round(kwhToday),
        kwhWeek: kwhWeek === null ? null : round(kwhWeek),
        kwhMonth: kwhMonth === null ? null : round(kwhMonth),
        costToday: cost(kwhToday),
        costMonth: cost(kwhMonth),
        powerFactor: pfs.length ? round(pfs.reduce((a, b) => a + b, 0) / pfs.length) : null,
        wastedTodayKwh,
      };
    });
  }

  async breakdown(
    tenant: EnergyTenant,
    scope: 'floor' | 'room',
    floor?: number,
  ): Promise<EnergyBreakdown> {
    return this.cached(`energy:breakdown:${tenant.key}:${scope}:${floor ?? 'all'}`, async () => {
      const now = await this.clock.now(tenant.key);
      const { day } = periodStarts(now, this.timeZone);
      const meters = (
        await this.meters(tenant.id, scope === 'floor' ? 'floor_meter' : 'room_meter')
      ).filter((m) => floor === undefined || m.location?.floor === floor);
      const snapshot = await this.live.snapshot(tenant.key);
      const live = new Map(snapshot.map((d) => [d.deviceCode, d]));
      const items = [];
      for (const { asset, location } of meters) {
        const state = live.get(asset.code);
        const latest = state ? num(state.values.energy_kwh) : null;
        const atMidnight =
          latest === null ? null : await this.readingAt(tenant.key, asset, day, now);
        const kwhToday = kwhSince(latest, atMidnight);
        items.push({
          scope,
          code: location?.code ?? asset.code,
          name: location?.name ?? asset.name,
          floor: location?.floor ?? null,
          locationId: location?.id ?? null,
          powerNowW: state ? num(state.values.power_w) : null,
          kwhToday,
          costToday: kwhToday === null ? null : round(kwhToday * tenant.tariffPerKwh, 2),
          share: null as number | null,
        });
      }
      const total = items.reduce((s, i) => s + (i.kwhToday ?? 0), 0);
      for (const i of items)
        i.share = total > 0 && i.kwhToday !== null ? round(i.kwhToday / total) : null;
      items.sort((a, b) => (b.kwhToday ?? 0) - (a.kwhToday ?? 0));
      return { scope, floor: floor ?? null, items };
    });
  }

  async top(tenant: EnergyTenant, limit = 5): Promise<TopConsumers> {
    const now = await this.clock.now(tenant.key);
    const { day } = periodStarts(now, this.timeZone);
    const rows = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({ asset: assets, location: locations })
        .from(assets)
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(and(inArray(assets.deviceType, CONSUMER_TYPES), isNotNull(assets.tbDeviceId))),
    );
    const snapshot = await this.live.snapshot(tenant.key);
    const live = new Map(snapshot.map((d) => [d.deviceCode, d]));
    const ranked = rows
      .map((r) => ({ ...r, powerNowW: num(live.get(r.asset.code)?.values.power_w) ?? 0 }))
      .sort((a, b) => b.powerNowW - a.powerNowW)
      .slice(0, limit);
    const items = [];
    for (const r of ranked) {
      const state = live.get(r.asset.code);
      // plugs carry a cumulative meter; lights and AC units do not
      const latest = state ? num(state.values.energy_kwh) : null;
      const kwhToday =
        latest === null
          ? null
          : kwhSince(latest, await this.readingAt(tenant.key, r.asset, day, now));
      items.push({
        assetId: r.asset.id,
        code: r.asset.code,
        name: r.asset.name,
        type: r.asset.deviceType ?? r.asset.type,
        room: r.location?.code ?? null,
        powerNowW: round(r.powerNowW, 1),
        kwhToday,
      });
    }
    return { items };
  }

  async trend(
    tenant: EnergyTenant,
    scope: 'building' | 'floor' | 'room',
    code: string | undefined,
    range: EnergyRange,
  ): Promise<EnergyTrend> {
    return this.cached(`energy:trend:${tenant.key}:${scope}:${code ?? ''}:${range}`, async () => {
      const now = await this.clock.now(tenant.key);
      const interval = ENERGY_RANGE_INTERVAL_MS[range];
      const to = Math.ceil(now / interval) * interval;
      const from = to - ENERGY_RANGE_MS[range];
      let meters: { asset: AssetRow; location: LocationRow | null }[];
      if (scope === 'building') meters = await this.meters(tenant.id, 'floor_meter');
      else {
        if (!code) throw badRequest('code is required for this scope');
        const all = await this.meters(tenant.id, scope === 'floor' ? 'floor_meter' : 'room_meter');
        meters = all.filter((m) =>
          scope === 'floor' ? String(m.location?.floor) === code : m.location?.code === code,
        );
        if (meters.length === 0) throw notFound(`No meter for ${scope} ${code}`);
      }
      const power: SeriesPoint[][] = [];
      const energy: SeriesPoint[][] = [];
      const pf: SeriesPoint[][] = [];
      for (const { asset } of meters) {
        const [avg, max] = await Promise.all([
          this.history.series(tenant.key, asset.tbDeviceId!, asset.code, {
            keys: ['power_w', 'pf'],
            from,
            to,
            interval,
            agg: 'AVG',
          }),
          this.history.series(tenant.key, asset.tbDeviceId!, asset.code, {
            keys: ['energy_kwh'],
            from: from - interval,
            to,
            interval,
            agg: 'MAX',
          }),
        ]);
        power.push(avg.series.power_w ?? []);
        pf.push(avg.series.pf ?? []);
        energy.push(energyPerBucket(max.series.energy_kwh ?? []));
      }
      return {
        scope,
        code: code ?? null,
        range,
        from,
        to,
        interval,
        power: sumSeries(power),
        energy: sumSeries(energy),
        powerFactor: meanSeries(pf),
      };
    });
  }
}

export type { DeviceLiveState };
