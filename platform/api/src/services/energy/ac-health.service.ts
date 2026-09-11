import { and, eq, isNotNull } from 'drizzle-orm';
import { ALARM_TYPES } from '@platform/shared/contracts';
import type { AcHealthItem, AcHealthReport } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, locations } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { LiveStateService } from '../live/live-state.service.js';
import type { MaintenanceService } from '../maintenance/maintenance.service.js';
import type { HistoryService } from './history.service.js';

const DAY_MS = 24 * 3_600_000;
/** Drift is measured between the last day and the same day two weeks earlier. */
export const DRIFT_LOOKBACK_DAYS = 14;
/** Above this relative rise in current at constant setpoint the unit is worth watching. */
export const DRIFT_WATCH = 0.1;
/** Mean power under which a window says nothing about the unit (it hardly ran). */
export const MIN_MEAN_POWER_W = 50;
/** The older window spans three days so a weekend or holiday does not blank it. */
const OLDER_WINDOW_DAYS = 3;

export function acStatus(filterAlarm: boolean, drift: number | null): AcHealthItem['status'] {
  if (filterAlarm) return 'alarm';
  if (drift !== null && drift > DRIFT_WATCH) return 'watch';
  return 'healthy';
}

/**
 * Relative change of current per watt (recent against older): a unit whose filter clogs draws more
 * current for the same cooling output, whatever its duty cycle was on either day. Null without
 * both windows or when the unit barely ran. Pure.
 */
export function currentDrift(
  recent: { currentA: number | null; powerW: number | null },
  older: { currentA: number | null; powerW: number | null },
): number | null {
  if (
    recent.currentA === null ||
    recent.powerW === null ||
    older.currentA === null ||
    older.powerW === null ||
    recent.powerW < MIN_MEAN_POWER_W ||
    older.powerW < MIN_MEAN_POWER_W
  )
    return null;
  const ratioRecent = recent.currentA / recent.powerW;
  const ratioOlder = older.currentA / older.powerW;
  if (ratioOlder <= 0) return null;
  return Math.round((ratioRecent / ratioOlder - 1) * 1000) / 1000;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** AC units with runtime, current trend, the filter alarm and the open maintenance task. */
export class AcHealthService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly live: LiveStateService,
    private readonly maintenance: MaintenanceService,
  ) {}

  async report(tenant: { id: string; key: string }, now: number): Promise<AcHealthReport> {
    const units = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({ asset: assets, room: locations.code })
        .from(assets)
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(and(eq(assets.deviceType, 'ac'), isNotNull(assets.tbDeviceId)))
        .orderBy(assets.code),
    );
    const snapshot = await this.live.snapshot(tenant.key);
    const liveByCode = new Map(snapshot.map((d) => [d.deviceCode, d]));
    const openTasks = await this.maintenance.openTaskIds(tenant.id);
    const items: AcHealthItem[] = [];
    for (const { asset, room } of units) {
      const live = liveByCode.get(asset.code);
      const nominal = num(asset.meta.nominalCurrentA);
      const avg = (key: string, from: number, to: number) =>
        this.history
          .aggregate(tenant.key, asset.tbDeviceId!, key, from, to, 'AVG')
          .catch(() => null);
      const olderTo = now - DRIFT_LOOKBACK_DAYS * DAY_MS;
      const olderFrom = olderTo - OLDER_WINDOW_DAYS * DAY_MS;
      const [recentA, recentW, olderA, olderW] = await Promise.all([
        avg('current_a', now - DAY_MS, now),
        avg('power_w', now - DAY_MS, now),
        avg('current_a', olderFrom, olderTo),
        avg('power_w', olderFrom, olderTo),
      ]);
      const drift = currentDrift(
        { currentA: recentA, powerW: recentW },
        { currentA: olderA, powerW: olderW },
      );
      const filterAlarm = live?.activeAlarms.includes(ALARM_TYPES.acCurrentHigh) ?? false;
      items.push({
        assetId: asset.id,
        code: asset.code,
        name: asset.name,
        room,
        runtimeH: num(live?.values.runtime_h),
        nominalCurrentA: nominal,
        currentNowA: num(live?.values.current_a),
        currentDrift: drift,
        filterAlarm,
        openTaskId: openTasks.get(asset.id) ?? null,
        warrantyEnd: asset.warrantyEnd,
        status: acStatus(filterAlarm, drift),
      });
    }
    const rank: Record<AcHealthItem['status'], number> = { alarm: 0, watch: 1, healthy: 2 };
    items.sort((a, b) => rank[a.status] - rank[b.status] || a.code.localeCompare(b.code));
    return { items };
  }
}
