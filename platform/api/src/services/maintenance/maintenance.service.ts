import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  CreateMaintenanceTask,
  MaintenanceResponse,
  MaintenanceTask,
  UpdateMaintenanceTask,
} from '@platform/shared/dto';
import type { Db, DbTx } from '../../db/index.js';
import {
  assets,
  locations,
  maintenanceTasks,
  type MaintenanceTaskRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { notFound } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS'] as const;

type TaskJoin = {
  task: MaintenanceTaskRow;
  asset: { id: string; code: string; name: string; type: string; warrantyEnd: string | null };
  room: string | null;
};

export function toTaskDto(row: TaskJoin): MaintenanceTask {
  return {
    id: row.task.id,
    asset: {
      id: row.asset.id,
      code: row.asset.code,
      name: row.asset.name,
      type: row.asset.type,
      room: row.room,
      warrantyEnd: row.asset.warrantyEnd,
    },
    title: row.task.title,
    cause: row.task.cause,
    status: row.task.status,
    createdFromAlarmId: row.task.createdFromAlarmId,
    notes: row.task.notes,
    closedAt: row.task.closedAt?.toISOString() ?? null,
    createdAt: row.task.createdAt.toISOString(),
    updatedAt: row.task.updatedAt.toISOString(),
  };
}

/**
 * Maintenance tasks on assets: created by people or by alarms (an "AC current high" alarm opens a
 * filter check on the unit), worked and closed by operations. An alarm never opens a second task
 * while one is open on the same asset; clearing the alarm adds a note and leaves the task open.
 */
export class MaintenanceService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly now: () => number = Date.now,
  ) {}

  private select(tx: DbTx) {
    return tx
      .select({
        task: maintenanceTasks,
        asset: {
          id: assets.id,
          code: assets.code,
          name: assets.name,
          type: assets.type,
          warrantyEnd: assets.warrantyEnd,
        },
        room: locations.code,
      })
      .from(maintenanceTasks)
      .innerJoin(assets, eq(assets.id, maintenanceTasks.assetId))
      .leftJoin(locations, eq(locations.id, assets.locationId));
  }

  async list(
    tenantId: string,
    query: { status?: string; assetId?: string; page: number; pageSize: number },
  ): Promise<MaintenanceResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const conds = [];
      if (query.status) conds.push(eq(maintenanceTasks.status, query.status as never));
      if (query.assetId) conds.push(eq(maintenanceTasks.assetId, query.assetId));
      const where = conds.length ? and(...conds) : undefined;
      const items = await this.select(tx)
        .where(where)
        .orderBy(
          sql`case when ${maintenanceTasks.status} in ('OPEN','IN_PROGRESS') then 0 else 1 end`,
          desc(maintenanceTasks.createdAt),
        )
        .limit(query.pageSize)
        .offset(query.page * query.pageSize);
      const [total] = await tx.select({ total: count() }).from(maintenanceTasks).where(where);
      return {
        items: items.map(toTaskDto),
        total: Number(total?.total ?? 0),
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async byId(tenantId: string, id: string): Promise<MaintenanceTask> {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      this.select(tx).where(eq(maintenanceTasks.id, id)).limit(1),
    );
    if (!row) throw notFound('Task not found');
    return toTaskDto(row);
  }

  /** Open task ids per asset, for the AC health list and the asset drawer. */
  async openTaskIds(tenantId: string): Promise<Map<string, string>> {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ assetId: maintenanceTasks.assetId, id: maintenanceTasks.id })
        .from(maintenanceTasks)
        .where(inArray(maintenanceTasks.status, [...OPEN_STATUSES]))
        .orderBy(desc(maintenanceTasks.createdAt)),
    );
    const out = new Map<string, string>();
    for (const r of rows) if (!out.has(r.assetId)) out.set(r.assetId, r.id);
    return out;
  }

  async create(
    tenant: { id: string },
    input: CreateMaintenanceTask & { createdFromAlarmId?: string | null },
  ): Promise<MaintenanceTask> {
    const id = await withTenant(this.db, tenant.id, async (tx) => {
      const [asset] = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.id, input.assetId))
        .limit(1);
      if (!asset) throw notFound('Asset not found');
      const [row] = await tx
        .insert(maintenanceTasks)
        .values({
          tenantId: tenant.id,
          assetId: input.assetId,
          title: input.title,
          cause: input.cause ?? null,
          createdFromAlarmId: input.createdFromAlarmId ?? null,
          createdAt: new Date(this.now()),
          updatedAt: new Date(this.now()),
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'maintenance.create',
        entityType: 'maintenance_task',
        entityId: row!.id,
        after: { assetId: input.assetId, title: input.title, cause: input.cause ?? null },
      });
      return row!.id;
    });
    return this.byId(tenant.id, id);
  }

  async update(
    tenant: { id: string },
    id: string,
    input: UpdateMaintenanceTask,
  ): Promise<MaintenanceTask> {
    await withTenant(this.db, tenant.id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(maintenanceTasks)
        .where(eq(maintenanceTasks.id, id))
        .limit(1);
      if (!existing) throw notFound('Task not found');
      const closing =
        input.status !== undefined &&
        (input.status === 'DONE' || input.status === 'CANCELLED') &&
        !existing.closedAt;
      await tx
        .update(maintenanceTasks)
        .set({
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(closing ? { closedAt: new Date(this.now()) } : {}),
          updatedAt: new Date(this.now()),
        })
        .where(eq(maintenanceTasks.id, id));
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'maintenance.update',
        entityType: 'maintenance_task',
        entityId: id,
        before: { status: existing.status, notes: existing.notes },
        after: { status: input.status ?? existing.status, notes: input.notes ?? existing.notes },
      });
    });
    return this.byId(tenant.id, id);
  }

  /**
   * An alarm on a device opens a task on its asset unless one is already open. Returns the task
   * and whether it was created now.
   */
  async openFromAlarm(
    tenant: { id: string },
    input: { assetId: string; title: string; cause: string; alarmId?: string | null },
  ): Promise<{ task: MaintenanceTask; created: boolean }> {
    const open = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({ id: maintenanceTasks.id })
        .from(maintenanceTasks)
        .where(
          and(
            eq(maintenanceTasks.assetId, input.assetId),
            inArray(maintenanceTasks.status, [...OPEN_STATUSES]),
          ),
        )
        .limit(1),
    );
    if (open[0]) return { task: await this.byId(tenant.id, open[0].id), created: false };
    const task = await this.create(tenant, {
      assetId: input.assetId,
      title: input.title,
      cause: input.cause,
      createdFromAlarmId: input.alarmId ?? null,
    });
    return { task, created: true };
  }

  /** Appends a note to the open task of an asset (alarm cleared); the task stays open. */
  async noteOnOpenTask(tenant: { id: string }, assetId: string, note: string): Promise<void> {
    await withTenant(this.db, tenant.id, async (tx) => {
      const [open] = await tx
        .select()
        .from(maintenanceTasks)
        .where(
          and(
            eq(maintenanceTasks.assetId, assetId),
            inArray(maintenanceTasks.status, [...OPEN_STATUSES]),
          ),
        )
        .limit(1);
      if (!open) return;
      const stamp = new Date(this.now()).toISOString();
      await tx
        .update(maintenanceTasks)
        .set({
          notes: `${open.notes ? `${open.notes}\n` : ''}${stamp} ${note}`,
          updatedAt: new Date(this.now()),
        })
        .where(eq(maintenanceTasks.id, open.id));
    });
  }
}
