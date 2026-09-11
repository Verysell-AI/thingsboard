import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  bookValueOf,
  type Asset,
  type AssetDetail,
  type AssetFacets,
  type AssetsQuery,
  type AssetsResponse,
  type AuditEntry,
  type Command,
  type CustodyEntry,
  type HistoryQuery,
  type HistoryResponse,
  type UpdateAsset,
} from '@platform/shared/dto';
import type { Db, DbTx } from '../../db/index.js';
import {
  assets,
  auditLog,
  commands,
  employees,
  locations,
  type AssetRow,
  type CommandRow,
  type EmployeeRow,
  type LocationRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClockService } from '../clock/clock.service.js';
import type { CommandActor, CommandsService } from '../commands/commands.service.js';
import { HistoryService } from '../energy/history.service.js';

type LocationRef = Pick<LocationRow, 'id' | 'code' | 'name' | 'type' | 'floor'>;
type EmployeeRef = Pick<EmployeeRow, 'id' | 'code' | 'name' | 'department' | 'email'>;

const HIDDEN_META = new Set(['accessToken', 'x', 'y']);

export function toAssetDto(
  row: AssetRow,
  location: LocationRef | null,
  custodian: EmployeeRef | null,
  misplaced: Pick<LocationRow, 'id' | 'code'> | null,
  nowMs: number,
): Asset {
  const cost = row.purchaseCost === null ? null : Number(row.purchaseCost);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    class: row.class,
    type: row.type,
    brand: row.brand,
    model: row.model,
    serial: row.serial,
    category: row.category,
    location: location
      ? {
          id: location.id,
          code: location.code,
          name: location.name,
          type: location.type,
          floor: location.floor,
        }
      : null,
    custodian: custodian
      ? {
          id: custodian.id,
          code: custodian.code,
          name: custodian.name,
          department: custodian.department,
          email: custodian.email,
        }
      : null,
    purchaseDate: row.purchaseDate,
    purchaseCost: cost,
    usefulLifeYears: row.usefulLifeYears,
    warrantyEnd: row.warrantyEnd,
    status: row.status,
    tbDeviceId: row.tbDeviceId,
    deviceType: row.deviceType,
    appliance: typeof row.meta.appliance === 'string' ? row.meta.appliance : null,
    sweepable: typeof row.meta.sweepable === 'boolean' ? row.meta.sweepable : null,
    x: typeof row.meta.x === 'number' ? row.meta.x : null,
    y: typeof row.meta.y === 'number' ? row.meta.y : null,
    misplacedRoom: misplaced ? { id: misplaced.id, code: misplaced.code } : null,
    bookValue: bookValueOf(cost, row.purchaseDate, row.usefulLifeYears, nowMs),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCommandDto(row: CommandRow): Command {
  return {
    id: row.id,
    assetId: row.assetId,
    method: row.method,
    params: row.params,
    source: row.source,
    actorUserId: row.actorUserId,
    automationRunId: row.automationRunId,
    result: row.result,
    error: row.error,
    sentAt: row.sentAt.toISOString(),
  };
}

const SORT_COLUMNS = {
  code: assets.code,
  name: assets.name,
  type: assets.type,
  location: locations.code,
  purchaseDate: assets.purchaseDate,
  warrantyEnd: assets.warrantyEnd,
} as const;

/** The asset register: listing, detail, edits with custody audit, commands and telemetry history. */
export class AssetsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly commandsSvc: CommandsService,
    private readonly historySvc: HistoryService,
  ) {}

  private joined(tx: DbTx) {
    const misplaced = alias(locations, 'misplaced');
    return {
      misplaced,
      query: tx
        .select({ asset: assets, location: locations, custodian: employees, misplaced })
        .from(assets)
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .leftJoin(employees, eq(employees.id, assets.custodianEmployeeId))
        .leftJoin(misplaced, eq(misplaced.id, assets.misplacedRoomId)),
    };
  }

  async list(tenant: { id: string; key: string }, query: AssetsQuery): Promise<AssetsResponse> {
    const now = await this.clock.now(tenant.key);
    return withTenant(this.db, tenant.id, async (tx) => {
      const conds: SQL[] = [];
      if (query.search) {
        const term = `%${query.search.trim()}%`;
        conds.push(
          or(
            ilike(assets.code, term),
            ilike(assets.name, term),
            ilike(assets.serial, term),
            ilike(assets.brand, term),
            ilike(assets.model, term),
            ilike(employees.name, term),
          )!,
        );
      }
      if (query.class) conds.push(eq(assets.class, query.class));
      if (query.type) conds.push(eq(assets.type, query.type));
      if (query.deviceType) conds.push(eq(assets.deviceType, query.deviceType));
      if (query.floor !== undefined) conds.push(eq(locations.floor, query.floor));
      if (query.room) conds.push(eq(locations.code, query.room));
      if (query.custodianId) conds.push(eq(assets.custodianEmployeeId, query.custodianId));
      if (query.status) conds.push(eq(assets.status, query.status));
      if (query.exceptions)
        conds.push(or(isNotNull(assets.misplacedRoomId), eq(assets.status, 'MISSING'))!);
      const where = conds.length ? and(...conds) : undefined;

      const { query: base } = this.joined(tx);
      const sortCol = SORT_COLUMNS[query.sort];
      const rows = await base
        .where(where)
        .orderBy(query.order === 'desc' ? desc(sortCol) : asc(sortCol), asc(assets.code))
        .limit(query.pageSize)
        .offset(query.page * query.pageSize);
      const totals = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(assets)
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .leftJoin(employees, eq(employees.id, assets.custodianEmployeeId))
        .where(where);
      return {
        items: rows.map((r) => toAssetDto(r.asset, r.location, r.custodian, r.misplaced, now)),
        total: totals[0]?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async facets(tenantId: string): Promise<AssetFacets> {
    return withTenant(this.db, tenantId, async (tx) => {
      const classes = await tx
        .selectDistinct({ v: assets.class })
        .from(assets)
        .orderBy(assets.class);
      const types = await tx.selectDistinct({ v: assets.type }).from(assets).orderBy(assets.type);
      const rooms = await tx
        .select({ code: locations.code, name: locations.name, floor: locations.floor })
        .from(locations)
        .where(eq(locations.type, 'ROOM'))
        .orderBy(locations.code);
      const floorRows = await tx
        .selectDistinct({ floor: locations.floor })
        .from(locations)
        .where(and(eq(locations.type, 'FLOOR'), isNotNull(locations.floor)));
      const custodianRows = await tx
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .innerJoin(assets, eq(assets.custodianEmployeeId, employees.id))
        .groupBy(employees.id, employees.name)
        .orderBy(employees.name);
      return {
        classes: classes.map((c) => c.v),
        types: types.map((t) => t.v),
        floors: floorRows.map((f) => f.floor!).sort((a, b) => a - b),
        rooms,
        custodians: custodianRows,
      };
    });
  }

  private async rowById(tx: DbTx, id: string) {
    const { query } = this.joined(tx);
    const rows = await query.where(eq(assets.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw notFound('Asset not found');
    return row;
  }

  async byId(tenant: { id: string; key: string }, id: string): Promise<Asset> {
    const now = await this.clock.now(tenant.key);
    return withTenant(this.db, tenant.id, async (tx) => {
      const r = await this.rowById(tx, id);
      return toAssetDto(r.asset, r.location, r.custodian, r.misplaced, now);
    });
  }

  async detail(tenant: { id: string; key: string }, id: string): Promise<AssetDetail> {
    const now = await this.clock.now(tenant.key);
    return withTenant(this.db, tenant.id, async (tx) => {
      const r = await this.rowById(tx, id);
      const commandRows = await tx
        .select()
        .from(commands)
        .where(eq(commands.assetId, id))
        .orderBy(desc(commands.sentAt))
        .limit(20);
      const auditRows = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, 'asset'), eq(auditLog.entityId, id)))
        .orderBy(desc(auditLog.ts))
        .limit(50);
      const audit: AuditEntry[] = auditRows.map((a) => ({
        id: a.id,
        ts: a.ts.toISOString(),
        actorType: a.actorType,
        actorLabel: a.actorLabel,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        before: a.before ?? null,
        after: a.after ?? null,
      }));
      const custody: CustodyEntry[] = auditRows
        .filter((a) => a.action === 'asset.custody')
        .map((a) => ({
          ts: a.ts.toISOString(),
          actor: a.actorLabel,
          from: custodianRef(a.before),
          to: custodianRef(a.after),
        }));
      const attributes: AssetDetail['attributes'] = {};
      for (const [k, v] of Object.entries(r.asset.meta)) {
        if (HIDDEN_META.has(k)) continue;
        if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
          attributes[k] = v as string | number | boolean | null;
      }
      return {
        ...toAssetDto(r.asset, r.location, r.custodian, r.misplaced, now),
        commands: commandRows.map(toCommandDto),
        custody,
        audit,
        attributes,
      };
    });
  }

  async update(
    tenant: { id: string; key: string },
    id: string,
    patch: UpdateAsset,
  ): Promise<Asset> {
    const now = await this.clock.now(tenant.key);
    return withTenant(this.db, tenant.id, async (tx) => {
      const before = await this.rowById(tx, id);
      if (patch.locationId) {
        const loc = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.id, patch.locationId))
          .limit(1);
        if (!loc[0]) throw badRequest('Unknown location');
      }
      let newCustodian: EmployeeRef | null | undefined;
      if (patch.custodianEmployeeId !== undefined) {
        if (patch.custodianEmployeeId === null) newCustodian = null;
        else {
          const rows = await tx
            .select()
            .from(employees)
            .where(eq(employees.id, patch.custodianEmployeeId))
            .limit(1);
          if (!rows[0]) throw badRequest('Unknown employee');
          newCustodian = rows[0];
        }
      }
      const { custodianEmployeeId, purchaseCost, ...rest } = patch;
      const set: Partial<typeof assets.$inferInsert> = { ...rest, updatedAt: new Date() };
      if (purchaseCost !== undefined)
        set.purchaseCost = purchaseCost === null ? null : purchaseCost.toFixed(2);
      if (custodianEmployeeId !== undefined) set.custodianEmployeeId = custodianEmployeeId;
      await tx.update(assets).set(set).where(eq(assets.id, id));

      const changed = Object.keys(rest).filter(
        (k) =>
          JSON.stringify((before.asset as Record<string, unknown>)[k]) !==
          JSON.stringify((rest as Record<string, unknown>)[k]),
      );
      if (purchaseCost !== undefined && Number(before.asset.purchaseCost) !== purchaseCost)
        changed.push('purchaseCost');
      if (changed.length) {
        const pick = (src: Record<string, unknown>) =>
          Object.fromEntries(changed.map((k) => [k, src[k] ?? null]));
        await this.audit.record(tx, {
          action: 'asset.update',
          entityType: 'asset',
          entityId: id,
          before: pick(before.asset as unknown as Record<string, unknown>),
          after: pick({ ...rest, purchaseCost } as Record<string, unknown>),
        });
      }
      if (
        newCustodian !== undefined &&
        (newCustodian?.id ?? null) !== before.asset.custodianEmployeeId
      ) {
        await this.audit.record(tx, {
          action: 'asset.custody',
          entityType: 'asset',
          entityId: id,
          before: before.custodian
            ? { id: before.custodian.id, name: before.custodian.name }
            : null,
          after: newCustodian ? { id: newCustodian.id, name: newCustodian.name } : null,
        });
      }
      const after = await this.rowById(tx, id);
      return toAssetDto(after.asset, after.location, after.custodian, after.misplaced, now);
    });
  }

  async command(
    tenant: { id: string; key: string },
    id: string,
    method: string,
    params: unknown,
    actor: CommandActor,
  ): Promise<Command> {
    const row = await this.commandsSvc.sendRpc(tenant, id, method, params, actor);
    return toCommandDto(row);
  }

  async history(
    tenant: { id: string; key: string },
    id: string,
    query: HistoryQuery,
  ): Promise<HistoryResponse> {
    const now = await this.clock.now(tenant.key);
    const asset = await withTenant(this.db, tenant.id, async (tx) => {
      const rows = await tx.select().from(assets).where(eq(assets.id, id)).limit(1);
      return rows[0] ?? null;
    });
    if (!asset) throw notFound('Asset not found');
    if (!asset.tbDeviceId) throw badRequest('Asset has no device');
    const req = HistoryService.normalise(query, now);
    return this.historySvc.series(tenant.key, asset.tbDeviceId, asset.code, req);
  }

  /** Assets with a device on the given rooms, for room views. */
  async devicesInRooms(tx: DbTx, roomIds: string[]): Promise<AssetRow[]> {
    if (roomIds.length === 0) return [];
    return tx
      .select()
      .from(assets)
      .where(and(isNotNull(assets.tbDeviceId), inArray(assets.locationId, roomIds)));
  }
}

function custodianRef(v: unknown): { id: string; name: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { id?: unknown; name?: unknown };
  return typeof o.id === 'string' && typeof o.name === 'string' ? { id: o.id, name: o.name } : null;
}
