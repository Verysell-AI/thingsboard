import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import {
  zonedDateParts,
  zonedDayKey,
  zonedMinutesOfDay,
  zonedTimeToEpoch,
} from '@platform/shared/clock';
import type { StandbyItem, StandbyReport } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import {
  assets,
  deviceNightlyStats,
  locations,
  standbyAcknowledgements,
  users,
  type TenantRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { notFound } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { HistoryService } from './history.service.js';

export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;
/** Standby band: a device drawing between these through the night is idle but not off. */
export const STANDBY_MIN_W = 5;
export const STANDBY_MAX_W = 80;
export const STANDBY_MIN_HOURS = 6;
export const STANDBY_WINDOW_NIGHTS = 7;
export const STANDBY_MIN_NIGHTS = 5;
/** Hours per day counted as avoidable standby for the yearly figure. */
const STANDBY_HOURS_PER_DAY = 8;
const SLOT_MS = 15 * 60_000;
/** Device families that can idle in standby; meters, sensors and laptops are not candidates. */
const CANDIDATE_TYPES = ['light', 'ac', 'plug'];
export const RECOMMENDATION = 'Put on a switched circuit and include it in the evening sweep';

export interface NightStat {
  avgNightPowerW: number;
  hoursAbove5w: number;
}

/** Night statistics from 15-minute average power samples. Pure. */
export function nightStatFrom(samples: number[]): NightStat | null {
  const valid = samples.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const above = valid.filter((v) => v > STANDBY_MIN_W).length;
  return {
    avgNightPowerW: Math.round(avg * 100) / 100,
    hoursAbove5w: Math.round(((above * SLOT_MS) / 3_600_000) * 100) / 100,
  };
}

/** Whether a device is a standby offender over its recent nights. Pure. */
export function standbyVerdict(nights: NightStat[]): { flagged: boolean; nightsFlagged: number } {
  const nightsFlagged = nights.filter(
    (n) =>
      n.avgNightPowerW >= STANDBY_MIN_W &&
      n.avgNightPowerW <= STANDBY_MAX_W &&
      n.hoursAbove5w >= STANDBY_MIN_HOURS,
  ).length;
  return { flagged: nightsFlagged >= STANDBY_MIN_NIGHTS, nightsFlagged };
}

export function yearlyKwh(avgNightPowerW: number): number {
  return Math.round(((avgNightPowerW * STANDBY_HOURS_PER_DAY * 365) / 1000) * 10) / 10;
}

/**
 * The standby hunt: nightly average power per device (22:00–06:00) from the telemetry history,
 * kept in `device_nightly_stats`, and the ranked list of devices that idle between 5 and 80 W on
 * most nights, with an audited "acceptable" acknowledgement.
 */
export class StandbyService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly history: HistoryService,
    private readonly timeZone: string,
  ) {}

  /** The evening date whose night ended this morning, once the business clock passes 06:00. */
  nightDue(now: number): string | null {
    if (zonedMinutesOfDay(now, this.timeZone) < NIGHT_END_HOUR * 60) return null;
    return zonedDayKey(now - 24 * 3_600_000, this.timeZone);
  }

  /** Computes and stores last night's statistics once per business day. */
  async nightlyCheck(tenant: TenantRow, now: number): Promise<number | null> {
    const night = this.nightDue(now);
    if (!night) return null;
    const existing = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({ assetId: deviceNightlyStats.assetId })
        .from(deviceNightlyStats)
        .where(eq(deviceNightlyStats.date, night))
        .limit(1),
    );
    if (existing.length) return null;
    return this.computeNight(tenant, night);
  }

  /** Night window [22:00 on `date`, 06:00 the next day) in the platform zone. */
  nightWindow(date: string): { from: number; to: number } {
    const [y, m, d] = date.split('-').map(Number);
    const base = { ...zonedDateParts(Date.now(), this.timeZone), year: y!, month: m!, day: d! };
    return {
      from: zonedTimeToEpoch(
        { ...base, hour: NIGHT_START_HOUR, minute: 0, second: 0 },
        this.timeZone,
      ),
      to: zonedTimeToEpoch(
        { ...base, day: d! + 1, hour: NIGHT_END_HOUR, minute: 0, second: 0 },
        this.timeZone,
      ),
    };
  }

  /** Reads every candidate device's night from history and upserts the statistics. */
  async computeNight(tenant: TenantRow, date: string): Promise<number> {
    const { from, to } = this.nightWindow(date);
    const devices = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({
          id: assets.id,
          tbDeviceId: assets.tbDeviceId,
          deviceType: assets.deviceType,
          meta: assets.meta,
        })
        .from(assets)
        .where(and(isNotNull(assets.tbDeviceId), inArray(assets.deviceType, CANDIDATE_TYPES))),
    );
    let written = 0;
    for (const d of devices) {
      if (d.deviceType === 'plug' && d.meta.appliance === 'fridge') continue;
      let stat: NightStat | null = null;
      try {
        const res = await this.history.series(tenant.key, d.tbDeviceId!, d.id, {
          keys: ['power_w'],
          from,
          to,
          interval: SLOT_MS,
          agg: 'AVG',
        });
        stat = nightStatFrom((res.series.power_w ?? []).map((p) => p.value));
      } catch {
        stat = null;
      }
      if (!stat) continue;
      await this.upsert(tenant.id, d.id, date, stat);
      written++;
    }
    return written;
  }

  async upsert(tenantId: string, assetId: string, date: string, stat: NightStat): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .insert(deviceNightlyStats)
        .values({
          tenantId,
          assetId,
          date,
          avgNightPowerW: stat.avgNightPowerW.toFixed(2),
          hoursAbove5w: stat.hoursAbove5w.toFixed(2),
        })
        .onConflictDoUpdate({
          target: [
            deviceNightlyStats.tenantId,
            deviceNightlyStats.assetId,
            deviceNightlyStats.date,
          ],
          set: {
            avgNightPowerW: stat.avgNightPowerW.toFixed(2),
            hoursAbove5w: stat.hoursAbove5w.toFixed(2),
          },
        }),
    );
  }

  async report(
    tenant: { id: string; key: string; currency: string; tariffPerKwh: number },
    now: number,
  ): Promise<StandbyReport> {
    const since = zonedDayKey(now - (STANDBY_WINDOW_NIGHTS + 1) * 24 * 3_600_000, this.timeZone);
    const { rows, acks } = await withTenant(this.db, tenant.id, async (tx) => ({
      rows: await tx
        .select({
          assetId: deviceNightlyStats.assetId,
          date: deviceNightlyStats.date,
          avg: deviceNightlyStats.avgNightPowerW,
          hours: deviceNightlyStats.hoursAbove5w,
          code: assets.code,
          name: assets.name,
          type: assets.type,
          room: locations.code,
        })
        .from(deviceNightlyStats)
        .innerJoin(assets, eq(assets.id, deviceNightlyStats.assetId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(gte(deviceNightlyStats.date, since))
        .orderBy(desc(deviceNightlyStats.date)),
      acks: await tx
        .select({
          assetId: standbyAcknowledgements.assetId,
          by: users.displayName,
        })
        .from(standbyAcknowledgements)
        .leftJoin(users, eq(users.id, standbyAcknowledgements.acknowledgedBy)),
    }));
    const byAsset = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byAsset.get(r.assetId) ?? [];
      if (list.length < STANDBY_WINDOW_NIGHTS) list.push(r);
      byAsset.set(r.assetId, list);
    }
    const ackBy = new Map(acks.map((a) => [a.assetId, a.by]));
    const items: StandbyItem[] = [];
    for (const [assetId, nights] of byAsset) {
      const stats = nights.map((n) => ({
        avgNightPowerW: Number(n.avg),
        hoursAbove5w: Number(n.hours),
      }));
      const verdict = standbyVerdict(stats);
      if (!verdict.flagged) continue;
      const avg = stats.reduce((a, b) => a + b.avgNightPowerW, 0) / stats.length;
      const kwh = yearlyKwh(avg);
      const first = nights[0]!;
      items.push({
        assetId,
        code: first.code,
        name: first.name,
        type: first.type,
        room: first.room,
        avgNightPowerW: Math.round(avg * 10) / 10,
        nightsFlagged: verdict.nightsFlagged,
        nightsObserved: stats.length,
        kwhPerYear: kwh,
        costPerYear: Math.round(kwh * tenant.tariffPerKwh * 100) / 100,
        recommendation: RECOMMENDATION,
        acknowledged: ackBy.has(assetId),
        acknowledgedBy: ackBy.get(assetId) ?? null,
      });
    }
    items.sort(
      (a, b) => Number(a.acknowledged) - Number(b.acknowledged) || b.kwhPerYear - a.kwhPerYear,
    );
    const open = items.filter((i) => !i.acknowledged);
    return {
      currency: tenant.currency,
      windowNights: STANDBY_WINDOW_NIGHTS,
      items,
      totalKwhPerYear: Math.round(open.reduce((a, b) => a + b.kwhPerYear, 0) * 10) / 10,
      totalCostPerYear: Math.round(open.reduce((a, b) => a + b.costPerYear, 0) * 100) / 100,
    };
  }

  async acknowledge(
    tenant: { id: string },
    assetId: string,
    input: { acknowledged: boolean; note?: string },
    userId: string | null,
  ): Promise<void> {
    await withTenant(this.db, tenant.id, async (tx) => {
      const [asset] = await tx
        .select({ id: assets.id, code: assets.code })
        .from(assets)
        .where(eq(assets.id, assetId))
        .limit(1);
      if (!asset) throw notFound('Asset not found');
      await tx.delete(standbyAcknowledgements).where(eq(standbyAcknowledgements.assetId, assetId));
      if (input.acknowledged)
        await tx.insert(standbyAcknowledgements).values({
          tenantId: tenant.id,
          assetId,
          acknowledgedBy: userId,
          note: input.note ?? null,
        });
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: input.acknowledged ? 'standby.acknowledge' : 'standby.unacknowledge',
        entityType: 'asset',
        entityId: assetId,
        after: { code: asset.code, note: input.note ?? null },
      });
    });
  }
}
