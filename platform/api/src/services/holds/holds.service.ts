import { desc, eq, gt } from 'drizzle-orm';
import type { CreateHold, Hold } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { holds, type HoldRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClockService } from '../clock/clock.service.js';

export function toHoldDto(row: HoldRow): Hold {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    until: row.until.toISOString(),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Holds keep a zone, floor or room powered until a business time whatever the automations decide:
 * "Still working" from a late worker, "Event tonight" from the automations page.
 */
export class HoldsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /** Holds still in force at the tenant's business time, newest first. */
  async list(tenant: { id: string; key: string }): Promise<Hold[]> {
    const now = await this.clock.now(tenant.key);
    const rows = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select()
        .from(holds)
        .where(gt(holds.until, new Date(now)))
        .orderBy(desc(holds.createdAt)),
    );
    return rows.map(toHoldDto);
  }

  async create(tenant: { id: string; key: string }, input: CreateHold): Promise<Hold> {
    const now = await this.clock.now(tenant.key);
    const until = new Date(input.until);
    if (!(until.getTime() > now)) throw badRequest('until must be in the future (business time)');
    const row = await withTenant(this.db, tenant.id, async (tx) => {
      const [inserted] = await tx
        .insert(holds)
        .values({
          tenantId: tenant.id,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          until,
          reason: input.reason,
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'hold.create',
        entityType: 'hold',
        entityId: inserted!.id,
        after: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          until: input.until,
          reason: input.reason,
        },
      });
      return inserted!;
    });
    return toHoldDto(row);
  }

  async delete(tenant: { id: string; key: string }, id: string): Promise<void> {
    await withTenant(this.db, tenant.id, async (tx) => {
      const [row] = await tx.delete(holds).where(eq(holds.id, id)).returning();
      if (!row) throw notFound('Hold not found');
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'hold.delete',
        entityType: 'hold',
        entityId: id,
        before: { scopeType: row.scopeType, scopeId: row.scopeId, until: row.until.toISOString() },
      });
    });
  }
}
