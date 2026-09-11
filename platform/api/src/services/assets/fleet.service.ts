import { and, eq, isNotNull } from 'drizzle-orm';
import type { FleetItem, FleetReport } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, employees, locations } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { HistoryService } from '../energy/history.service.js';
import type { LiveStateService } from '../live/live-state.service.js';

const DAY_MS = 24 * 3_600_000;
export const BATTERY_WINDOW_DAYS = 30;
/** Mean docked battery level below this reads as a worn battery: replace within six months. */
export const BATTERY_REPLACE_PCT = 60;
export const RECLAIM_AFTER_DAYS = 30;
export const WARRANTY_WARNING_DAYS = 90;

export interface FleetFacts {
  batteryHealthPct: number | null;
  online: boolean;
  lastOnlineAt: number | null;
  warrantyEnd: string | null;
  misplaced: boolean;
}

/** Fleet flags for one laptop. Pure. */
export function fleetFlags(facts: FleetFacts, now: number): FleetItem['flags'] {
  const flags: FleetItem['flags'] = [];
  if (facts.batteryHealthPct !== null && facts.batteryHealthPct < BATTERY_REPLACE_PCT)
    flags.push('replace_soon');
  const daysOffline = facts.online
    ? 0
    : facts.lastOnlineAt === null
      ? Infinity
      : (now - facts.lastOnlineAt) / DAY_MS;
  if (daysOffline >= RECLAIM_AFTER_DAYS) flags.push('reclaim');
  if (facts.warrantyEnd) {
    const days = (Date.parse(`${facts.warrantyEnd}T00:00:00Z`) - now) / DAY_MS;
    if (days >= 0 && days <= WARRANTY_WARNING_DAYS) flags.push('warranty_expiring');
  }
  if (facts.misplaced) flags.push('misplaced');
  return flags;
}

/** Laptop fleet health: battery trend, reachability, warranty and misplacement per laptop. */
export class FleetService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly live: LiveStateService,
  ) {}

  async report(tenant: { id: string; key: string }, now: number): Promise<FleetReport> {
    const laptops = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({
          asset: assets,
          custodian: employees.name,
          department: employees.department,
          misplacedRoom: locations.code,
        })
        .from(assets)
        .leftJoin(employees, eq(employees.id, assets.custodianEmployeeId))
        .leftJoin(locations, eq(locations.id, assets.misplacedRoomId))
        .where(and(eq(assets.deviceType, 'laptop'), isNotNull(assets.tbDeviceId)))
        .orderBy(assets.code),
    );
    const snapshot = await this.live.snapshot(tenant.key);
    const liveByCode = new Map(snapshot.map((d) => [d.deviceCode, d]));
    const items: FleetItem[] = [];
    for (const row of laptops) {
      const live = liveByCode.get(row.asset.code);
      const battery = await this.history
        .aggregate(
          tenant.key,
          row.asset.tbDeviceId!,
          'battery',
          now - BATTERY_WINDOW_DAYS * DAY_MS,
          now,
          'AVG',
        )
        .catch(() => null);
      const lastOnlineAt = live?.ts ?? null;
      const facts: FleetFacts = {
        batteryHealthPct: battery === null ? null : Math.round(battery),
        online: live?.online ?? false,
        lastOnlineAt,
        warrantyEnd: row.asset.warrantyEnd,
        misplaced: row.asset.misplacedRoomId !== null,
      };
      items.push({
        assetId: row.asset.id,
        code: row.asset.code,
        name: row.asset.name,
        custodian: row.custodian,
        department: row.department,
        batteryHealthPct: facts.batteryHealthPct,
        lastOnlineAt: lastOnlineAt === null ? null : new Date(lastOnlineAt).toISOString(),
        daysOffline: facts.online
          ? 0
          : lastOnlineAt === null
            ? null
            : Math.floor((now - lastOnlineAt) / DAY_MS),
        warrantyEnd: row.asset.warrantyEnd,
        flags: fleetFlags(facts, now),
      });
    }
    return {
      total: items.length,
      online: items.filter((i) => i.daysOffline === 0).length,
      replaceSoon: items.filter((i) => i.flags.includes('replace_soon')).length,
      reclaim: items.filter((i) => i.flags.includes('reclaim')).length,
      warrantyExpiring: items.filter((i) => i.flags.includes('warranty_expiring')).length,
      items,
    };
  }
}
