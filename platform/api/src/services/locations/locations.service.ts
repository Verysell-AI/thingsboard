import { and, eq, isNotNull } from 'drizzle-orm';
import type { FloorPlan, Location, LocationType } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, employees, locations, type LocationRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { notFound } from '../../lib/errors.js';

export function toLocationDto(row: LocationRow): Location {
  const g = row.geometry;
  const geometry =
    g && g.x !== undefined && g.y !== undefined && g.w !== undefined && g.h !== undefined
      ? { x: g.x, y: g.y, w: g.w, h: g.h }
      : null;
  return {
    id: row.id,
    type: row.type,
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    floor: row.floor,
    zone: row.zone,
    kind: (row.kind as Location['kind']) ?? null,
    capacity: row.capacity,
    critical: row.critical,
    geometry,
    tbAssetId: row.tbAssetId,
    accessPoint: row.geometry?.accessPoint ?? null,
  };
}

export class LocationsService {
  constructor(private readonly db: Db) {}

  async list(
    tenantId: string,
    filter: { type?: LocationType; floor?: number },
  ): Promise<Location[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const conds = [];
      if (filter.type) conds.push(eq(locations.type, filter.type));
      if (filter.floor !== undefined) conds.push(eq(locations.floor, filter.floor));
      const rows = await tx
        .select()
        .from(locations)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(locations.type, locations.code);
      return rows.map(toLocationDto);
    });
  }

  async byId(tenantId: string, id: string): Promise<Location> {
    const row = await withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(locations).where(eq(locations.id, id)).limit(1);
      return rows[0] ?? null;
    });
    if (!row) throw notFound('Location not found');
    return toLocationDto(row);
  }

  async floorPlan(tenantId: string, floor: number): Promise<FloorPlan> {
    return withTenant(this.db, tenantId, async (tx) => {
      const floorRows = await tx
        .select()
        .from(locations)
        .where(and(eq(locations.type, 'FLOOR'), eq(locations.floor, floor)))
        .limit(1);
      const floorRow = floorRows[0];
      if (!floorRow) throw notFound(`Floor ${floor} not found`);
      const onFloor = await tx.select().from(locations).where(eq(locations.floor, floor));
      const rooms = onFloor.filter((l) => l.type === 'ROOM');
      const zones = onFloor.filter((l) => l.type === 'ZONE');
      const roomIds = new Set(rooms.map((r) => r.id));
      const roomCodeById = new Map(rooms.map((r) => [r.id, r.code]));

      const deskEmployees = await tx
        .select({ id: employees.id, deskCode: employees.deskCode })
        .from(employees)
        .where(isNotNull(employees.deskCode));
      const employeeByDesk = new Map(deskEmployees.map((e) => [e.deskCode, e.id]));

      const desks = rooms.flatMap((r) =>
        (r.geometry?.desks ?? []).map((d) => ({
          code: d.code,
          room: r.code,
          zone: d.zone,
          x: d.x,
          y: d.y,
          employeeId: employeeByDesk.get(d.code) ?? d.employeeId ?? null,
        })),
      );

      const assetRows = await tx.select().from(assets).where(isNotNull(assets.tbDeviceId));
      const devices = assetRows
        .filter((a) => (a.locationId && roomIds.has(a.locationId)) || a.locationId === floorRow.id)
        .map((a) => ({
          code: a.code,
          type: a.deviceType ?? a.type,
          name: a.name,
          room: a.locationId ? (roomCodeById.get(a.locationId) ?? null) : null,
          appliance: typeof a.meta.appliance === 'string' ? a.meta.appliance : null,
          x: typeof a.meta.x === 'number' ? a.meta.x : null,
          y: typeof a.meta.y === 'number' ? a.meta.y : null,
          assetId: a.id,
        }));

      return {
        floor: toLocationDto(floorRow),
        rooms: rooms.map(toLocationDto),
        zones: zones.map(toLocationDto),
        desks,
        devices,
      };
    });
  }
}
