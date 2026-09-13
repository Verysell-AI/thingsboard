import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { zonedDateParts, zonedDayKey, zonedTimeToEpoch } from '@platform/shared/clock';
import type { SavingsFloor, SavingsReport } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, automationRuns, locations } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { HistoryService } from '../energy/history.service.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const NIGHT_FROM_HOUR = 20;
export const NIGHT_TO_HOUR = 7;
export const BASELINE_WEEKS = 8;
export const RECENT_WEEKS = 4;
/** The IoT core refuses aggregations over ~700 buckets, so hourly history is read two weeks at a time. */
export const CHUNK_MS = 14 * DAY_MS;

export interface HourPoint {
  ts: number;
  value: number;
}

/**
 * kWh per weekday night (20:00 on a weekday → 07:00 the next day) from hourly average power. The
 * night is keyed by its evening date. Pure.
 */
export function nightKwhFrom(points: HourPoint[], timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    const parts = zonedDateParts(p.ts, timeZone);
    let eveningMs: number;
    if (parts.hour >= NIGHT_FROM_HOUR) eveningMs = p.ts;
    else if (parts.hour < NIGHT_TO_HOUR) eveningMs = p.ts - DAY_MS;
    else continue;
    const evening = zonedDateParts(eveningMs, timeZone);
    if (evening.weekday === 0 || evening.weekday === 6) continue;
    const key = zonedDayKey(eveningMs, timeZone);
    out.set(key, (out.get(key) ?? 0) + p.value / 1000);
  }
  for (const [k, v] of out) out.set(k, Math.round(v * 1000) / 1000);
  return out;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Night-time energy versus the pre-automation baseline, per floor, from the floor meters. */
export class SavingsService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly timeZone: string,
  ) {}

  /** The first business day the evening sweep actually ran; null before any sweep. */
  async automationSince(tenantId: string): Promise<string | null> {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ since: sql<string | null>`min(${automationRuns.summary} ->> 'actedDay')` })
        .from(automationRuns)
        .where(
          and(eq(automationRuns.key, 'evening_sweep'), sql`${automationRuns.summary} ? 'actedDay'`),
        ),
    );
    return row?.since ?? null;
  }

  /** Night kWh per evening date per floor over [from, to). */
  async nightsByFloor(
    tenant: { id: string; key: string },
    from: number,
    to: number,
  ): Promise<Map<number, Map<string, number>>> {
    const meters = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({
          tbDeviceId: assets.tbDeviceId,
          floor: locations.floor,
          meta: assets.meta,
          id: assets.id,
        })
        .from(assets)
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(and(eq(assets.deviceType, 'floor_meter'), isNotNull(assets.tbDeviceId))),
    );
    const out = new Map<number, Map<string, number>>();
    for (const m of meters) {
      const metaFloor = Number(m.meta.floor);
      const floor = m.floor ?? (Number.isFinite(metaFloor) ? metaFloor : 0);
      const points: HourPoint[] = [];
      for (let start = from; start < to; start += CHUNK_MS) {
        const end = Math.min(to, start + CHUNK_MS);
        try {
          const res = await this.history.series(tenant.key, m.tbDeviceId!, m.id, {
            keys: ['power_w'],
            from: start,
            to: end,
            interval: HOUR_MS,
            agg: 'AVG',
          });
          for (const p of res.series.power_w ?? []) points.push({ ts: p.ts, value: p.value });
        } catch {
          // a missing chunk leaves those nights out
        }
      }
      const nights = nightKwhFrom(points, this.timeZone);
      const existing = out.get(floor);
      if (existing) for (const [k, v] of nights) existing.set(k, (existing.get(k) ?? 0) + v);
      else out.set(floor, nights);
    }
    return out;
  }

  async report(
    tenant: { id: string; key: string; currency: string; tariffPerKwh: number },
    now: number,
  ): Promise<SavingsReport> {
    const since = (await this.automationSince(tenant.id)) ?? zonedDayKey(now, this.timeZone);
    const sinceMs = zonedTimeToEpoch(
      { ...zonedDateParts(now, this.timeZone), ...dateParts(since), hour: 0, minute: 0, second: 0 },
      this.timeZone,
    );
    const from = sinceMs - BASELINE_WEEKS * 7 * DAY_MS;
    const to = Math.min(now, sinceMs + RECENT_WEEKS * 7 * DAY_MS + DAY_MS);
    const byFloor = await this.nightsByFloor(tenant, from, to);
    const floors: SavingsFloor[] = [];
    const nightTotals = new Map<string, number>();
    for (const [floor, nights] of [...byFloor.entries()].sort((a, b) => a[0] - b[0])) {
      const baseline = [...nights.entries()].filter(([d]) => d < since).map(([, v]) => v);
      const recent = [...nights.entries()].filter(([d]) => d >= since).map(([, v]) => v);
      const b = mean(baseline);
      const r = mean(recent);
      floors.push({
        floor,
        baselineNightKwh: round3(b),
        recentNightKwh: round3(r),
        savedKwhPerNight: round3(b - r),
        savedPct: b > 0 ? Math.round(((b - r) / b) * 1000) / 1000 : 0,
      });
      for (const [d, v] of nights) nightTotals.set(d, (nightTotals.get(d) ?? 0) + v);
    }
    const recentNights = [...nightTotals.keys()].filter((d) => d >= since).length;
    const totalSavedKwh = round3(floors.reduce((a, f) => a + f.savedKwhPerNight, 0) * recentNights);
    return {
      currency: tenant.currency,
      baselineWeeks: BASELINE_WEEKS,
      recentWeeks: RECENT_WEEKS,
      automationSince: since,
      floors,
      totalSavedKwh,
      totalSavedCost: Math.round(totalSavedKwh * tenant.tariffPerKwh * 100) / 100,
      nights: [...nightTotals.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, kwh]) => ({ date, kwh: round3(kwh), baseline: date < since })),
    };
  }

  /** Measured kWh saved on one night against the baseline; null without enough data. */
  async measuredForNight(
    tenant: { id: string; key: string },
    date: string,
    now: number,
  ): Promise<number | null> {
    const since = await this.automationSince(tenant.id);
    if (!since || date < since) return null;
    const report = await this.report({ ...tenant, currency: '', tariffPerKwh: 0 }, now);
    if (!report.floors.some((f) => f.baselineNightKwh > 0)) return null;
    const night = report.nights.find((n) => n.date === date);
    if (!night) return null;
    const baseline = report.floors.reduce((a, f) => a + f.baselineNightKwh, 0);
    return round3(baseline - night.kwh);
  }
}

function dateParts(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;
